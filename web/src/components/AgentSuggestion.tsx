import { Sparkles } from 'lucide-react';
import { theme } from '../theme';

interface Props {
  title?: string;
  reason: string;
  onAccept?: () => void;
  onEdit?: () => void;
}

export function AgentSuggestion({ title = 'AI Suggestion', reason, onAccept, onEdit }: Props) {
  return (
    <div style={{
      background: theme.colors.accent + '10',
      border: `1.5px solid ${theme.colors.accent}40`,
      borderRadius: 14,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 8, background: theme.colors.accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Sparkles size={15} color="#fff" strokeWidth={1.5} />
      </span>

      <div style={{ flex: 1 }}>
        <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: theme.colors.ink }}>{title}</p>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: theme.colors.grey }}>{reason}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onAccept} style={{
            padding: '5px 14px', borderRadius: theme.radius.pill, border: 'none', cursor: 'pointer',
            background: theme.colors.ink, color: '#fff', fontSize: 12, fontWeight: 600,
          }}>
            Accept
          </button>
          <button onClick={onEdit} style={{
            padding: '5px 14px', borderRadius: theme.radius.pill, cursor: 'pointer',
            background: 'transparent', border: `1.5px solid ${theme.colors.ink}`,
            color: theme.colors.ink, fontSize: 12, fontWeight: 600,
          }}>
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}
