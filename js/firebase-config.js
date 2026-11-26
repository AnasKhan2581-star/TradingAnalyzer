// ─────────────────────────────────────────────────────────────────────────────
// Google sign-in + cloud sync configuration (Firebase).
//
// 1. Create a free project at https://console.firebase.google.com
// 2. Build → Authentication → Get started → Sign-in method → enable "Google".
//    Authentication → Settings → Authorized domains → add your site's domain
//    (e.g. anaskhan2581-star.github.io).
// 3. Build → Firestore Database → Create database (production mode), then paste
//    the rules from firestore.rules (in this repo) into the "Rules" tab → Publish.
// 4. Project settings → General → "Your apps" → add a Web app (</>) and copy the
//    firebaseConfig object below. These values are public identifiers, not secrets;
//    access is protected by the Firestore rules.
//
// Leave as null to run without accounts (everything is still saved locally).
// ─────────────────────────────────────────────────────────────────────────────
export const firebaseConfig = null;
/* Example:
export const firebaseConfig = {
  apiKey: 'AIza…',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};
*/
