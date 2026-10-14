import { useEffect, useState } from 'react';
import type { Role, Skill } from '../../../shared/types';
import { Avatar } from '../sprites/Avatar';
import { MODELS, roleIdFromName, toggle, toolChoices } from '../team/roleForm';

interface Props { role: Role; isNew: boolean; takenIds: string[]; skills: Skill[]; onSaved: (role: Role) => void; onSkillsChanged: () => void; onError: (m: string) => void }

export function RoleEditor({ role, isNew, takenIds, skills, onSaved, onSkillsChanged, onError }: Props) {
  const [draft, setDraft] = useState<Role>(role);
  const [hireName, setHireName] = useState('');
  const [newSkill, setNewSkill] = useState<{ name: string; description: string; body: string } | null>(null);
  const [saved, setSaved] = useState(false);
  // Reset only when a different role is picked; a refreshed copy of the same role must not wipe the form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(role); setSaved(false); }, [role.id, isNew]);
  const set = (patch: Partial<Role>) => { setDraft((d) => ({ ...d, ...patch })); setSaved(false); };

  const save = async () => {
    const toSave = isNew ? { ...draft, id: roleIdFromName(draft.name, takenIds) } : draft;
    try { const r = await window.agentOffice.saveRole(toSave); setSaved(true); onSaved(r); } catch (e) { onError(String(e)); }
  };
  const hire = async () => {
    try { await window.agentOffice.hire(draft.id, hireName.trim() || undefined); setHireName(''); } catch (e) { onError(String(e)); }
  };
  const addSkill = async () => {
    if (!newSkill) return;
    try {
      const s = await window.agentOffice.saveSkill({ id: roleIdFromName(newSkill.name, skills.map((x) => x.id)), ...newSkill });
      setNewSkill(null);
      onSkillsChanged();
      set({ skills: [...draft.skills, s.id] });
    } catch (e) { onError(String(e)); }
  };

  return (
    <section className="editor" aria-label="Role editor">
      <div className="row" style={{ gap: 14 }}>
        <Avatar look={draft.look} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="pixel" style={{ margin: 0, fontSize: 22, overflowWrap: 'anywhere' }}>{draft.name || 'New role'}</h2>
          <span className="small muted">Role template · used by every agent hired with it</span>
        </div>
        {(['hair', 'shirt', 'skin'] as const).map((k) => (
          <label key={k} className="field small" style={{ alignItems: 'center' }}>
            <span className="label">{k}</span>
            <input type="color" value={draft.look[k]} onChange={(e) => set({ look: { ...draft.look, [k]: e.target.value.toUpperCase() } })} style={{ width: 36, height: 28, padding: 0, border: 0, background: 'none' }} />
          </label>
        ))}
      </div>
      <div className="grid-2">
        <div className="field"><label htmlFor="re-name">Name</label><input id="re-name" className="input" value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} /></div>
        <div className="field"><label htmlFor="re-blurb">Short description</label><input id="re-blurb" className="input" value={draft.blurb} maxLength={120} onChange={(e) => set({ blurb: e.target.value })} /></div>
        <div className="field">
          <label htmlFor="re-model">Model</label>
          <select id="re-model" className="input" value={draft.model} onChange={(e) => set({ model: e.target.value })}>
            {[...new Set([...MODELS, draft.model])].map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="re-perm">Permission mode</label>
          <select id="re-perm" className="input" value={draft.permissionMode} onChange={(e) => set({ permissionMode: e.target.value as Role['permissionMode'] })}>
            <option value="acceptEdits">acceptEdits</option><option value="default">default</option><option value="plan">plan</option><option value="bypassPermissions">bypassPermissions</option>
          </select>
        </div>
      </div>
      {draft.permissionMode === 'bypassPermissions' && <p className="warn" role="note">bypassPermissions lets this role run any command without asking. Only use it for repos you can afford to lose.</p>}
      <div className="field">
        <span className="label">Allowed tools</span>
        <div className="row">
          {toolChoices(draft).map((t) => <button key={t} type="button" className="toggle" aria-pressed={draft.allowedTools.includes(t)} onClick={() => set({ allowedTools: toggle(draft.allowedTools, t) })}>{t}</button>)}
        </div>
      </div>
      <div className="field">
        <label htmlFor="re-prompt">System prompt</label>
        <textarea id="re-prompt" className="input mono" rows={6} value={draft.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} />
      </div>
      <div className="field">
        <div className="row"><span className="label">Skills</span><button type="button" className="btn small" style={{ marginLeft: 'auto' }} onClick={() => setNewSkill({ name: '', description: '', body: '' })}>Add skill file</button></div>
        {skills.map((s) => (
          <label key={s.id} className="skill-row">
            <input type="checkbox" checked={draft.skills.includes(s.id)} onChange={() => set({ skills: toggle(draft.skills, s.id) })} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} />
            <span className="mono">{s.id}.md</span>
            <span className="muted small" style={{ marginLeft: 'auto' }}>{s.description}</span>
          </label>
        ))}
        {newSkill && (
          <div className="panel-box">
            <div className="grid-2">
              <div className="field"><label htmlFor="ns-name">Skill name</label><input id="ns-name" className="input" value={newSkill.name} onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="ns-desc">Description</label><input id="ns-desc" className="input" value={newSkill.description} onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="ns-body">Instructions (markdown)</label><textarea id="ns-body" className="input mono" rows={5} value={newSkill.body} onChange={(e) => setNewSkill({ ...newSkill, body: e.target.value })} /></div>
            <div className="row"><button type="button" className="btn teal small" onClick={() => void addSkill()}>Save skill</button><button type="button" className="btn small" onClick={() => setNewSkill(null)}>Cancel</button></div>
          </div>
        )}
      </div>
      <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        <button type="button" className="btn" onClick={() => void save()} disabled={!draft.name.trim()}>Save role</button>
        {saved && <span className="small ok">Saved</span>}
        {!isNew && draft.id !== 'boss' && (
          <div className="row" style={{ marginLeft: 'auto' }}>
            <label htmlFor="hire-name" className="sr-only">Name for the new hire (optional)</label>
            <input id="hire-name" className="input" placeholder="Name (optional)" value={hireName} maxLength={40} onChange={(e) => setHireName(e.target.value)} />
            <button type="button" className="btn primary" onClick={() => void hire()}>Hire {draft.name}</button>
          </div>
        )}
      </div>
    </section>
  );
}
