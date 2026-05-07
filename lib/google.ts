import { google } from "googleapis";

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthenticatedClient() {
  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

export function getCalendar() {
  return google.calendar({ version: "v3", auth: getAuthenticatedClient() });
}

export function getSheets() {
  return google.sheets({ version: "v4", auth: getAuthenticatedClient() });
}
