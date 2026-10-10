export const theme = {
  colors: {
    background: '#EFEFEF',
    card:       '#FFFFFF',
    ink:        '#23252B',
    accent:     '#C47A57',
    grey:       '#9EA0A5',
    track:      '#E7E7E7',
    sage:       '#5E8C7A',
    red:        '#C2553D',
    sand:       '#D9A066',
  },
  dept: {
    HR:        '#C47A57',
    IT:        '#23252B',
    Finance:   '#5E8C7A',
    Marketing: '#9EA0A5',
  },
  priority: {
    Critical: '#C2553D',
    High:     '#C47A57',
    Medium:   '#D9A066',
    Low:      '#9EA0A5',
  },
  radius: { card: 20, pill: 9999 },
  space: { gap: 16, pad: 24 },
  font: { family: "'Inter', system-ui, sans-serif", kpi: 44, title: 15, label: 12 },
  shadow: '0 2px 12px rgba(35,37,43,0.07)',
} as const;

export type Dept = keyof typeof theme.dept;
export type Priority = keyof typeof theme.priority;
