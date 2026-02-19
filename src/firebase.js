// src/firebase.js
// Firebase is initialized using environment variables.
// For local dev: create a .env file in the project root (see .env.example).
// For CI/CD: add the variables as GitHub Secrets or Vercel Environment Variables.

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const defaults = {
  apiKey: "AIzaSyD3wOz8IeoHSWdIpx2IRvKRgFSUvTP2Psw",
  authDomain: "project-ganttflow.firebaseapp.com",
  projectId: "project-ganttflow",
  storageBucket: "project-ganttflow.firebasestorage.app",
  messagingSenderId: "962417433940",
  appId: "1:962417433940:web:bd511eec55bfa3afc9bcc1",
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || defaults.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || defaults.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || defaults.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || defaults.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || defaults.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || defaults.appId,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
