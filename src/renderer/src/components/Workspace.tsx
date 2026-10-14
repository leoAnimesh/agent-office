import type { UiState } from '../state';
import { BossChat } from './BossChat';
import { TaskBoard } from './TaskBoard';
import { TeamPanel } from './TeamPanel';

export function Workspace({ state, onError, onDismiss }: { state: UiState; onError: (m: string) => void; onDismiss: (i: number) => void }) {
  const ws = state.ws!;
  return (
    <div className="workspace">
      <header className="ws-header">
        <h1>{ws.project.name}</h1>
        <span className="mono muted small">{ws.project.repoPath} · {ws.project.baseBranch}</span>
      </header>
      {state.errors.length > 0 && (
        <div className="errors" role="alert">
          {state.errors.map((m, i) => (
            <div key={i} className="error-row">
              <span>{m.replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')}</span>
              <button type="button" aria-label="Dismiss error" onClick={() => onDismiss(i)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="ws-body">
        <TeamPanel agents={ws.agents} logs={state.logs} onError={onError} />
        <TaskBoard tasks={ws.tasks} agents={ws.agents} onError={onError} />
        <BossChat chat={ws.chat} merges={ws.merges} onError={onError} />
      </div>
    </div>
  );
}
