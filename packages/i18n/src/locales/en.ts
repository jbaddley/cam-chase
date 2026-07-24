/** English is the source catalog; its keys define MessageKey for all locales. */
export const en = {
  'app.title': 'PhotoChase',
  'app.tagline': 'Snap the clue, strike the pose, chase the shot.',
  'lobby.teamsJoined': '{count} teams joined',
  'lobby.waitingForTeams': 'Waiting for at least 2 teams…',
  'game.start': 'Start game',
  'round.photosLeft': '{count} photos left',
  'round.timeLeft': '{minutes} minutes left',
  'rating.rateThis': 'Rate this chase',
  'results.winner': '{team} wins!',
  'error.gameFull': 'This game is full.',
} as const;

export type MessageKey = keyof typeof en;
