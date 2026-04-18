export interface MomentType {
  id: string;
  label: string;
  emoji: string;
  color: string;
}

export const MOMENT_TYPES: Record<string, MomentType[]> = {
  nfl: [
    { id: 'touchdown', label: 'Touchdown', emoji: '🏈', color: '#0096ff' },
    { id: 'interception', label: 'Interception', emoji: '🤚', color: '#ff4444' },
    { id: 'fumble', label: 'Fumble', emoji: '💨', color: '#ff8c00' },
    { id: 'sack', label: 'Sack', emoji: '💥', color: '#cc0000' },
    { id: 'field_goal', label: 'Field Goal', emoji: '🎯', color: '#00c853' },
    { id: 'big_play', label: 'Big Play', emoji: '⚡', color: '#ffc107' },
    { id: 'reaction', label: 'Reaction', emoji: '😤', color: '#6c5ce7' },
  ],
  nba: [
    { id: 'three_pointer', label: 'Three Pointer', emoji: '🎯', color: '#ff8c00' },
    { id: 'dunk', label: 'Dunk', emoji: '🔨', color: '#cc0000' },
    { id: 'block', label: 'Block', emoji: '🚫', color: '#0096ff' },
    { id: 'steal', label: 'Steal', emoji: '🤏', color: '#00c853' },
    { id: 'alley_oop', label: 'Alley-Oop', emoji: '🏀', color: '#ffc107' },
    { id: 'buzzer_beater', label: 'Buzzer Beater', emoji: '⏰', color: '#ff4444' },
    { id: 'reaction', label: 'Reaction', emoji: '😱', color: '#6c5ce7' },
  ],
  soccer: [
    { id: 'goal', label: 'Goal', emoji: '⚽', color: '#00c853' },
    { id: 'save', label: 'Save', emoji: '🧤', color: '#0096ff' },
    { id: 'penalty', label: 'Penalty', emoji: '🎯', color: '#ff4444' },
    { id: 'foul', label: 'Foul', emoji: '🦶', color: '#ff8c00' },
    { id: 'red_card', label: 'Red Card', emoji: '🟥', color: '#cc0000' },
    { id: 'yellow_card', label: 'Yellow Card', emoji: '🟨', color: '#ffc107' },
    { id: 'var', label: 'VAR', emoji: '📺', color: '#6c5ce7' },
    { id: 'reaction', label: 'Reaction', emoji: '🔥', color: '#ff4444' },
  ],
  mls: [], // will reference soccer
  mlb: [
    { id: 'home_run', label: 'Home Run', emoji: '💣', color: '#cc0000' },
    { id: 'strikeout', label: 'Strikeout', emoji: '🔥', color: '#ff8c00' },
    { id: 'double_play', label: 'Double Play', emoji: '✌️', color: '#0096ff' },
    { id: 'diving_catch', label: 'Diving Catch', emoji: '🤿', color: '#00c853' },
    { id: 'walk_off', label: 'Walk-Off', emoji: '🎬', color: '#ffc107' },
    { id: 'reaction', label: 'Reaction', emoji: '🤯', color: '#6c5ce7' },
  ],
  nhl: [
    { id: 'goal', label: 'Goal', emoji: '🏒', color: '#cc0000' },
    { id: 'save', label: 'Save', emoji: '🧤', color: '#0096ff' },
    { id: 'hit', label: 'Big Hit', emoji: '💥', color: '#ff8c00' },
    { id: 'fight', label: 'Fight', emoji: '🥊', color: '#ff4444' },
    { id: 'power_play', label: 'Power Play', emoji: '⚡', color: '#ffc107' },
    { id: 'reaction', label: 'Reaction', emoji: '🔥', color: '#6c5ce7' },
  ],
  worldcup: [
    { id: 'goal', label: 'Goal', emoji: '⚽', color: '#00c853' },
    { id: 'save', label: 'Save', emoji: '🧤', color: '#0096ff' },
    { id: 'penalty', label: 'Penalty', emoji: '🎯', color: '#ff4444' },
    { id: 'foul', label: 'Foul', emoji: '🦶', color: '#ff8c00' },
    { id: 'red_card', label: 'Red Card', emoji: '🟥', color: '#cc0000' },
    { id: 'yellow_card', label: 'Yellow Card', emoji: '🟨', color: '#ffc107' },
    { id: 'var', label: 'VAR', emoji: '📺', color: '#6c5ce7' },
    { id: 'substitution', label: 'Substitution', emoji: '🔄', color: '#8888aa' },
    { id: 'offside', label: 'Offside', emoji: '🚩', color: '#ff4444' },
    { id: 'half_time', label: 'Half-Time', emoji: '⏸️', color: '#8888aa' },
    { id: 'full_time', label: 'Full-Time', emoji: '🏁', color: '#00c853' },
    { id: 'reaction', label: 'Reaction', emoji: '🔥', color: '#ff4444' },
  ],
  default: [
    { id: 'big_play', label: 'Big Play', emoji: '⚡', color: '#ffc107' },
    { id: 'highlight', label: 'Highlight', emoji: '✨', color: '#6c5ce7' },
    { id: 'reaction', label: 'Reaction', emoji: '🔥', color: '#ff4444' },
    { id: 'discussion', label: 'Discussion', emoji: '💬', color: '#0096ff' },
  ],
};

// Make MLS reference soccer types
MOMENT_TYPES.mls = MOMENT_TYPES.soccer;

export const REACTION_EMOJIS = ['🔥', '❤️', '💪', '😤', '🏆', '👏', '😱', '💀', '🐐', '👀', '😂', '🫡'];

export function getMomentTypesForSport(sportId: string): MomentType[] {
  return MOMENT_TYPES[sportId] || MOMENT_TYPES.default;
}
