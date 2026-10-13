# Recette visuelle et contre-exemples

Le bouton **Installer le reporter qualité** copie ces fichiers dans `.feature-studio/quality-kit/` du dépôt courant sans écraser les personnalisations. Aucun navigateur, package ou service n’est installé/lancé par ce bouton.

Le dépôt doit déjà disposer de `@playwright/test`, de son navigateur et d’une application/fixture locale. Ne ciblez pas la production ou un profil de navigateur personnel. Utilisez une application locale dédiée et des données factices : les captures et traces peuvent contenir ce que les tests voient.

Dans votre configuration Playwright de tests, ajoutez :

```ts
reporter: [['list'], ['./.feature-studio/quality-kit/playwright-reporter.cjs']],
use: { trace: 'on', screenshot: 'on' },
```

Conservez votre configuration `webServer` locale existante si nécessaire. Le reporter ne démarre aucun serveur et ne modifie pas le navigateur. Configurez une commande approuvée dans Feature Studio, par exemple :

- Exécutable : `node`
- Arguments : `["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.quality.config.ts"]`
- Collecte : **Recette visuelle** ou **Contre-exemples**
- Rapport : `.feature-studio/quality/report.json`

Le host transmet le chemin du rapport et un identifiant unique de tentative au processus ; il n’est pas nécessaire de les ajouter dans la configuration. Ne lancez pas ce reporter manuellement pour produire une prétendue preuve hôte.

Les identifiants de critères doivent exister dans le centre de validation de la session **avant le lancement de la tentative**. Le host fige cette liste ; une référence inconnue rend le rapport invalide, même si Playwright annonce un succès. Un vrai échec d’infrastructure peut rester un cas échoué sans critère. Un seul rapport n’est pas obligé de couvrir tous les critères, et le rapport ne valide pas leur statut humain.

Annotez les critères et rendez les scénarios lisibles :

```ts
import { test, expect } from '@playwright/test';
test('Nom vide : explication visible', async ({ page }, info) => {
  info.annotations.push(
    { type: 'criterion', description: 'C1' },
    { type: 'expected', description: 'Un nom vide empêche la sauvegarde.' },
    { type: 'reproduction', description: 'Ouvrir le formulaire, vider Nom, cliquer Enregistrer.' },
  );
  await test.step('Ouvrir le formulaire local', async () => page.goto('/profile'));
  await test.step('Soumettre un nom vide', async () => {
    await page.getByLabel('Nom').fill('');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('alert')).toContainText('Nom requis');
  });
});
```

La commande exécute exactement les arguments configurés, sans shell. La recette ne reçoit aucune permission de modifier le code de production. Le rapport et les médias sont bornés (1 Mio JSON, 16 Mio par média, 64 Mio au total, 60 pièces et 200 cas), sans chemins absolus, traversées, liens symboliques ou HTML. Les erreurs et textes sont filtrés par le filtre de secrets existant. Les captures et traces brutes sont conservées localement dans le stockage privé, accessibles seulement sur action humaine.

Les traces sont enregistrées via une boîte de dialogue, jamais envoyées vers un visualiseur en ligne. Ouvrez-les si besoin avec votre Playwright local approuvé. Une trace est un fichier, pas une autorisation de navigation ou d’exécution. Les captures se consultent par le viewer hôte.

Les étapes de `quality-feature` fixent `requiredQuality: visual` et `requiredQuality: counterexample`. Les agents standards de ces deux rôles gardent également cette exigence dans un parcours personnalisé. La validation humaine comme automatique exige un rapport réussi du type requis, lié à la feature, à la tentative, à la commande et à la preuve hôte courantes. Une commande ordinaire réussie ne remplace pas ce rapport. Un rapport absent, ancien, invalide, vide ou incomplet bloque la validation. Une assertion échouée produit un contre-exemple : attendu, observé, reproduction et preuve. Une correction automatique n’est possible que si la route, le budget, le nombre de cycles et les tentatives sont déjà configurés. Les critères d’acceptation restent validés manuellement.
