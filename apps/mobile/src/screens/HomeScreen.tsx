import { ScrollView, StyleSheet, View } from 'react-native';
import { t } from '../i18n.js';
import { color, space } from '../theme.js';
import { Body, Button, Display } from '../ui.js';

/**
 * The first screen: two big choices, and nothing else competing with them.
 *
 * Before this, joining *was* the home screen — three text fields and five
 * buttons stacked together, so the two things almost everyone opens the app to
 * do were mixed in with a form most of them did not want yet. Splitting them
 * leaves both the join and host screens free to be about one thing each.
 *
 * The solo and social surfaces stay reachable but quiet: they matter to people
 * who already play, and to nobody opening the app for the first time.
 */
export function HomeScreen({
  onJoin,
  onHost,
  onDailyHunt,
  onLeagues,
  onInvite,
  onProfile,
}: {
  onJoin: () => void;
  onHost: () => void;
  onDailyHunt?: () => void;
  onLeagues?: () => void;
  onInvite?: () => void;
  onProfile?: () => void;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <Display>{t('app.title')}</Display>
        <Body muted>{t('app.tagline')}</Body>
      </View>

      <View style={styles.choices}>
        <Button onPress={onHost}>{t('home.host')}</Button>
        <Button onPress={onJoin}>{t('home.join')}</Button>
      </View>

      <ScrollView contentContainerStyle={styles.quiet}>
        {onDailyHunt ? (
          <Button onPress={onDailyHunt} tone="secondary">
            {t('daily.title')}
          </Button>
        ) : null}
        {onLeagues ? (
          <Button onPress={onLeagues} tone="secondary">
            {t('league.title')}
          </Button>
        ) : null}
        {onInvite ? (
          <Button onPress={onInvite} tone="secondary">
            {t('referral.title')}
          </Button>
        ) : null}
        {onProfile ? (
          <Button onPress={onProfile} tone="secondary">
            {t('settings.title')}
          </Button>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space.xl, gap: space.xl, backgroundColor: color.surface },
  // The name sits above the fold with room around it; this is the screen that
  // has to say what the app is.
  hero: { paddingTop: space.xxl, gap: space.sm },
  choices: { gap: space.md },
  quiet: { gap: space.sm, paddingTop: space.sm },
});
