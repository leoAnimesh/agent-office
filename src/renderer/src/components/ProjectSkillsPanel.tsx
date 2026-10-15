import { useEffect, useState } from 'react';
import { MAX_PROJECT_SKILLS, type Project, type Skill } from '../../../shared/types';
import { addableSkills, skillChips } from '../team/projectSkills';

interface Props { project: Project; onError: (m: string) => void }

/** The skills every employee on this project gets. The boss picks them; the user can add and remove. */
export function ProjectSkillsPanel({ project, onError }: Props) {
  const [lib, setLib] = useState<Skill[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => { window.agentOffice.listSkills().then(setLib, (e) => onError(String(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chips = skillChips(project, lib);
  const options = addableSkills(project, lib);
  const edit = async (e: { add?: string[]; remove?: string[] }) => {
    try { await window.agentOffice.setProjectSkills(e); setPick(''); } catch (err) { onError(String(err)); }
  };

  return (
    <section className="skills-panel" aria-label="Project skills">
      <div className="skills-head">
        <h3>Project skills</h3>
        <span className="small muted mono">{chips.length} / {MAX_PROJECT_SKILLS}</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {project.skills === undefined ? "The boss hasn't picked skills for this project yet." : 'Every employee on this project gets these.'}
      </p>
      {chips.length > 0 && (
        <ul className="skill-chips">
          {chips.map((c) => (
            <li key={c.id} className="skill-chip" title={c.reason}>
              <span>{c.name}</span>
              <span className="small muted">by {c.by}</span>
              <button type="button" className="skill-remove" aria-label={`Remove ${c.name}`} onClick={() => void edit({ remove: [c.id] })}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row skills-add">
        <label htmlFor="skill-add" className="small muted">Add skill</label>
        <select id="skill-add" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose a skill…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button type="button" className="btn small" disabled={!pick} onClick={() => void edit({ add: [pick] })}>Add</button>
      </div>
    </section>
  );
}
