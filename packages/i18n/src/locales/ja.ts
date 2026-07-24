import type { MessageKey } from './en.js';

/** Japanese — second next-wave locale (docs/06-i18n-markets.md). */
export const ja: Record<MessageKey, string> = {
  'app.title': 'PhotoChase',
  'app.tagline': '手がかりを撮って、ポーズを決めて、写真を追え。',
  'lobby.teamsJoined': '{count}チームが参加しました',
  'lobby.waitingForTeams': '2チーム以上の参加を待っています…',
  'game.start': 'ゲーム開始',
  'round.photosLeft': '残り{count}枚',
  'round.timeLeft': '残り{minutes}分',
  'rating.rateThis': 'この追跡を評価する',
  'results.winner': '{team}の勝ち！',
  'error.gameFull': 'このゲームは満員です。',
};
