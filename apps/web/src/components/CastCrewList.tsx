import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listVideoCredits, roleLabel, roleEmoji, type Person,
} from '../lib/api';

interface Props {
  videoId: string;
}

export default function CastCrewList({ videoId }: Props) {
  const navigate = useNavigate();
  const [people, setPeople] = useState<Person[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!videoId) return;
    listVideoCredits(videoId)
      .then((res) => setPeople(res.people))
      .catch(() => setPeople([]));
  }, [videoId]);

  if (people.length === 0) return null;

  // Group by role
  const byRole = new Map<string, Person[]>();
  for (const p of people) {
    if (!byRole.has(p.role)) byRole.set(p.role, []);
    byRole.get(p.role)!.push(p);
  }

  const roleOrder = ['actor', 'voice_actor', 'presenter', 'director', 'producer', 'writer',
    'composer', 'cinematographer', 'editor', 'animator', 'researcher', 'other'];
  const sortedRoles = Array.from(byRole.keys()).sort(
    (a, b) => roleOrder.indexOf(a) - roleOrder.indexOf(b)
  );

  const INITIAL_LIMIT = 3;
  const visibleRoles = expanded ? sortedRoles : sortedRoles.slice(0, INITIAL_LIMIT);
  const hasMore = sortedRoles.length > INITIAL_LIMIT;

  return (
    <div className="mf-castcrew">
      <div className="mf-castcrew-header">
        <span className="mf-castcrew-title">🎬 Cast &amp; Crew</span>
        <span className="mf-castcrew-count">{people.length}</span>
      </div>

      <div className="mf-castcrew-body">
        {visibleRoles.map((role) => (
          <div key={role} className="mf-castcrew-row">
            <span className="mf-castcrew-role">
              {roleEmoji(role)} {roleLabel(role)}
            </span>
            <span className="mf-castcrew-names">
              {byRole.get(role)!.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <button
                    className="mf-castcrew-name"
                    onClick={() => navigate(`/person/${encodeURIComponent(p.name)}`)}
                    title={`View all videos with ${p.name}`}
                  >
                    {p.name}
                  </button>
                  {p.character_name && (
                    <span className="mf-castcrew-character"> as {p.character_name}</span>
                  )}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          className="mf-castcrew-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : `Show all (${sortedRoles.length})`}
        </button>
      )}
    </div>
  );
}
