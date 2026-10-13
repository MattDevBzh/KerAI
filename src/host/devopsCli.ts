import { readFile } from 'node:fs/promises';
import { AzureDevOps, type SecretStore } from './AzureDevOps';
import { devOpsQuerySchema, devOpsTestTargetSchema } from '../core/devopsKitSchemas';
import { redact } from './process';

const help = `Inspection Azure DevOps en lecture seule (Node 22+)

node ado-readonly.cjs --organization ORG --project PROJET --repository DEPOT --query '{"kind":"pipelines"}'
node ado-readonly.cjs --organization ORG --project PROJET --repository DEPOT --verify test-target.json

PAT : variable d'environnement AZURE_DEVOPS_EXT_PAT. Aucun jeton dans les arguments.
Droits : Code et Build en lecture ; Test Management en lecture pour les tests.
--query : pipelines, pipeline, builds, build, timeline, artifacts ou test-runs (voir SKILL.md).
--verify : JSON avec buildId, pipelineId, commit (40 caractères), branch (refs/heads/...), environment,
isolationConfirmed, expectedStages, expectedArtifacts et requireTestResults.

Toutes les requêtes sont des GET. Aucun lancement, création, modification ou téléchargement.
Le script vérifie les faits distants seulement : son export ne remplace pas la preuve hôte de Feature Studio.
Codes : 0 collecte complète/contrôles réussis ; 1 erreur/échec ; 2 collecte incomplète.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(help);
    return;
  }
  const options: Record<string, string> = {};
  const allowed = new Set(['--organization', '--project', '--repository', '--query', '--verify']);
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || options[args[i]] || !args[i + 1])
      throw new Error('Arguments invalides. Utilise --help.');
    options[args[i]] = args[i + 1];
  }
  if (
    !options['--organization'] ||
    !options['--project'] ||
    !options['--repository'] ||
    Boolean(options['--query']) === Boolean(options['--verify'])
  )
    throw new Error('Indique organisation, projet, dépôt et soit --query, soit --verify.');
  const token = process.env.AZURE_DEVOPS_EXT_PAT?.trim();
  if (!token || token.length > 2000 || /[\r\n]/.test(token))
    throw new Error('AZURE_DEVOPS_EXT_PAT absent ou invalide.');
  const secrets: SecretStore = {
    get: async () => token,
    store: async () => {
      throw new Error('Lecture seule.');
    },
    delete: async () => {
      throw new Error('Lecture seule.');
    },
  };
  const api = new AzureDevOps(
    {
      organization: options['--organization'],
      project: options['--project'],
      repository: options['--repository'],
      remote: 'origin',
    },
    secrets,
  ).inspector();
  if (options['--query']) {
    if (options['--query'].length > 8000) throw new Error('Requête trop longue.');
    const result = await api.inspect(devOpsQuerySchema.parse(JSON.parse(options['--query'])));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.truncated) process.exitCode = 2;
  } else {
    const raw = await readFile(options['--verify']);
    if (raw.length > 32000) throw new Error('Déclaration de test trop volumineuse.');
    const result = await api.verify(devOpsTestTargetSchema.parse(JSON.parse(raw.toString('utf8'))));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.status === 'passed' ? 0 : result.status === 'incomplete' ? 2 : 1;
  }
}
main().catch((error: unknown) => {
  // Schema diagnostics may contain user data: only controlled error messages are printed.
  process.stderr.write(
    redact(
      error instanceof Error && error.name !== 'ZodError' && !(error instanceof SyntaxError)
        ? error.message
        : 'Paramètres ou réponse invalides. Utilise --help.',
    ) + '\n',
  );
  process.exitCode = 1;
});
