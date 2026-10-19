import { Award, Check, Gift, Sparkles, Trophy } from 'lucide-react';
import {
  rewards,
  rewardById,
  rewardKinds,
  rewardProgress,
  type RewardDefinition,
} from '../src/shared/rewards';
import type { QuestState } from '../src/shared/quests';
import { useRewards } from './RewardProvider';
import { useThemePreference } from './ThemePicker';
import { send } from './bridge';
import './rewards.css';
import './reward-effects.css';

export function RewardPreview({ reward }: { reward: RewardDefinition }) {
  return (
    <div
      className={`reward-preview reward-preview-${reward.id}`}
      role="img"
      aria-label={`Aperçu : ${reward.name}`}
    >
      {reward.kind === 'theme' && (
        <div className="reward-mini-studio" aria-hidden="true">
          <i />
          <div>
            <b /> <span />
            <span />
            <span />
          </div>
        </div>
      )}
      {reward.kind === 'title' && (
        <>
          <Award size={30} aria-hidden="true" />
          <span>{reward.name}</span>
        </>
      )}
      {reward.id === 'eiffel' && (
        <>
          <img src={`${import.meta.env.BASE_URL}rewards/eiffel.png`} alt="" />
          <span className="preview-sparks" aria-hidden="true">
            ✦　 ✧<br />
            　✦　 ✶
          </span>
        </>
      )}
      {reward.id === 'kitten' && <span className="kitten-sprite resting" aria-hidden="true" />}
    </div>
  );
}
function RewardButton({ reward }: { reward: RewardDefinition }) {
  const { state, pending, equip } = useRewards();
  const { theme } = useThemePreference();
  const selected =
    reward.kind === 'theme' ? theme === reward.id : state?.selection[reward.kind] === reward.id;
  return (
    <button
      className={`button ${selected ? 'secondary' : 'primary'}`}
      disabled={Boolean(pending) || !state?.ready || Boolean(state.error)}
      onClick={() => equip(reward.id, !selected)}
      aria-label={`${selected ? 'Désactiver' : 'Activer'} ${reward.name}`}
    >
      {selected ? <Check size={15} /> : <Sparkles size={15} />}
      {pending === reward.id ? 'Enregistrement…' : selected ? 'Activé · Retirer' : 'Activer'}
    </button>
  );
}
export function RewardsUI({ progression }: { progression: QuestState }) {
  const { state, error } = useRewards();
  const progress = rewardProgress(progression.trophies);
  const collection = rewards.filter((reward) => state?.unlocked.includes(reward.id));
  return (
    <section className="rewards-section" aria-label="Récompenses">
      {progress.next ? (
        <article
          className="reward-next"
          aria-labelledby="next-reward-title"
          data-reward-id={progress.next.id}
        >
          <RewardPreview reward={progress.next} />
          <div className="reward-next-content">
            <span className="eyebrow">
              <Gift size={14} /> PROCHAINE RÉCOMPENSE
            </span>
            <h2 id="next-reward-title">
              {rewardKinds[progress.next.kind]} · {progress.next.name}
            </h2>
            <p>{progress.next.description}</p>
            <div className="reward-gauge-label">
              <strong>
                Encore {progress.remaining} trophée{progress.remaining > 1 ? 's' : ''} !
              </strong>
              <span>
                <Trophy size={14} /> {progress.next.threshold}
              </span>
            </div>
            <progress
              max={progress.max}
              value={progress.value}
              aria-label="Progression vers la prochaine récompense"
              aria-valuetext={`${progression.trophies} trophées, encore ${progress.remaining} avant ${progress.next.name}`}
            />
            <div className="reward-gauge-scale">
              <span>{progress.previous} trophées</span>
              <span>{progress.next.threshold} trophées</span>
            </div>
          </div>
        </article>
      ) : (
        <div className="rewards-complete" role="status">
          <Trophy size={32} />
          <div>
            <h2>Toutes les récompenses actuelles sont débloquées !</h2>
            <p>Ta collection est complète. Les quêtes continuent à faire grandir ton palmarès.</p>
          </div>
        </div>
      )}
      <div className="reward-collection-heading">
        <h2>Mes récompenses</h2>
        <span>
          {collection.length} débloquée{collection.length > 1 ? 's' : ''}
        </span>
      </div>
      <p className="reward-collection-help">
        Les cadeaux restent acquis. Choisis ceux que tu souhaites activer.
      </p>
      {(error || state?.error) && (
        <div className="reward-error" role="alert">
          <p>{error || state?.error}</p>
          <button className="text-button" onClick={() => send({ type: 'refreshRewards' })}>
            Actualiser les récompenses
          </button>
        </div>
      )}
      {!state?.ready && !state?.error && <p role="status">Lecture de ta collection…</p>}
      {state?.ready && !collection.length && (
        <p className="reward-empty">Ta première récompense t’attend au prochain palier.</p>
      )}
      <div className="reward-collection">
        {collection.map((reward) => (
          <article className="reward-card" key={reward.id} data-reward-id={reward.id}>
            <RewardPreview reward={reward} />
            <div className="reward-card-body">
              <span className="reward-kind">
                {rewardKinds[reward.kind]} · {reward.threshold} trophées
              </span>
              <h3>{reward.name}</h3>
              <p>{reward.description}</p>
              <RewardButton reward={reward} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
export function RewardUnlockNotice() {
  const { newlyUnlocked, dismiss, state, error } = useRewards();
  const id = newlyUnlocked.find((id) => state?.unlocked.includes(id));
  const reward = id && rewardById.get(id);
  if (!reward) return null;
  return (
    <aside className="reward-unlock" aria-label="Nouvelle récompense">
      <RewardPreview reward={reward} />
      <div>
        <span className="eyebrow" role="status">
          NOUVEAU CADEAU DÉBLOQUÉ
        </span>
        <strong>{reward.name}</strong>
        <p>{reward.description}</p>
        {error && <p role="alert">{error}</p>}
      </div>
      <RewardButton reward={reward} />
      <button className="text-button" onClick={() => dismiss(reward.id)}>
        Plus tard
      </button>
    </aside>
  );
}
export function RewardTitle() {
  const { state } = useRewards();
  const id = state?.selection.title;
  if (!id || state.error || !state.unlocked.includes(id)) return null;
  return (
    <span className="reward-title" aria-label={`Titre : ${rewardById.get(id)!.name}`}>
      <Award size={14} aria-hidden="true" />
      {rewardById.get(id)!.name}
    </span>
  );
}
