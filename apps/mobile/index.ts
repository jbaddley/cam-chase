import { registerRootComponent } from 'expo';
import { PhotoChaseApp } from './src/root.js';

// Expo's entry point. The real native boundaries are wired in `src/root.tsx`;
// `App.tsx` stays free of them so it can be rendered in tests.
registerRootComponent(PhotoChaseApp);
