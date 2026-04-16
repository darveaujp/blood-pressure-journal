import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

// Google OAuth configuration
// IMPORTANT: You must set up your own Google Cloud project and OAuth credentials
// See: https://developers.google.com/identity/protocols/oauth2
const GOOGLE_CLIENT_ID = '95671801287-hrnjokhdiksen39vhougb4aqfvi1ur0n.apps.googleusercontent.com';

export const isConfigured = !GOOGLE_CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID');

// For Google OAuth with Expo Go, we must use the Expo proxy URL
// This is the ONLY URI that works with Google OAuth requirements (must be https://)
// Add this EXACT URI in Google Cloud Console:
// https://auth.expo.io/@darveaujp/blood-pressure-journal
const GOOGLE_REDIRECT_URI = 'https://auth.expo.io/@darveaujp/blood-pressure-journal';

// Google OAuth endpoints
const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
];

WebBrowser.maybeCompleteAuthSession();

export type GoogleAuthResult = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
};

export async function signInWithGoogle(): Promise<GoogleAuthResult | null> {
  if (!isConfigured) {
    throw new Error(
      'Google Drive is not configured. Please set up a Google Cloud project and update GOOGLE_CLIENT_ID in googleDriveService.ts'
    );
  }

  try {
    // Log configuration for debugging
    console.log('Google OAuth Configuration:');
    console.log('  Client ID:', GOOGLE_CLIENT_ID);
    console.log('  Redirect URI:', GOOGLE_REDIRECT_URI);
    console.log('  Scopes:', SCOPES);

    // Use expo-auth-session to build the request with PKCE
    const request = new AuthSession.AuthRequest({
      clientId: GOOGLE_CLIENT_ID,
      scopes: SCOPES,
      redirectUri: GOOGLE_REDIRECT_URI,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
    });

    // Wait for the request to be ready (generates code verifier, etc.)
    const authUrl = await request.makeAuthUrlAsync({
      authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
    });
    console.log('  Auth URL:', authUrl);

    console.log('Auth request prepared:');
    console.log('  Code Verifier present:', !!request.codeVerifier);
    console.log('  State:', request.state);

    // Discover the Google OAuth configuration
    const discovery = {
      authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    };

    // Prompt the user to authenticate
    // Note: We're using the Expo proxy URL as redirectUri, which handles the proxy behavior
    const promptAsync = await request.promptAsync(discovery);

    console.log('Auth prompt result:', promptAsync);

    if (promptAsync.type === 'success') {
      const { code } = promptAsync.params;

      // Exchange the code for an access token
      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId: GOOGLE_CLIENT_ID,
          code,
          redirectUri: GOOGLE_REDIRECT_URI,
          extraParams: {
            code_verifier: request.codeVerifier || '',
          },
        },
        discovery
      );

      console.log('Token exchange result:', tokenResponse);

      if (tokenResponse.accessToken) {
        return {
          accessToken: tokenResponse.accessToken,
          refreshToken: tokenResponse.refreshToken || undefined,
          expiresIn: tokenResponse.expiresIn || 3600,
        };
      }

      throw new Error('No access token received from token exchange');
    }

    if (promptAsync.type === 'cancel' || promptAsync.type === 'dismiss') {
      return null;
    }

    throw new Error(`Auth failed: ${promptAsync.type}`);
  } catch (error: any) {
    console.error('Google sign-in error:', error);
    throw new Error(
      'Google OAuth failed. Please verify:\n' +
      '1. Your Client ID is correct\n' +
      '2. The redirect URI (https://auth.expo.io/@darveaujp/blood-pressure-journal) is configured in Google Cloud Console\n' +
      '3. Your email is added as a test user\n' +
      '4. In "APIs & Services > OAuth consent screen", add drive.file and drive.appdata scopes\n' +
      '5. The app is configured for "TVs and Limited Input devices" or "Android" in Google Cloud\n' +
      'Error: ' + (error.message || 'Unknown error')
    );
  }
}

export async function uploadToGoogleDrive(
  accessToken: string,
  fileUri: string,
  fileName: string
): Promise<{ id: string; webViewLink: string }> {
  if (!isConfigured) {
    throw new Error('Google Drive is not configured');
  }

  try {
    // First, check if our app folder exists or create it
    const folderMetadata = {
      name: 'Blood Pressure Journal',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['appDataFolder'],
    };

    // Search for existing folder
    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='Blood Pressure Journal' and mimeType='application/vnd.google-apps.folder' and 'appDataFolder' in parents&spaces=appDataFolder`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const searchResult = await searchResponse.json();
    let folderId: string;

    if (searchResult.files && searchResult.files.length > 0) {
      folderId = searchResult.files[0].id;
    } else {
      // Create folder
      const createFolderResponse = await fetch(
        'https://www.googleapis.com/drive/v3/files',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(folderMetadata),
        }
      );

      const folderResult = await createFolderResponse.json();
      folderId = folderResult.id;
    }

    // Now upload the file
    const metadata = {
      name: fileName,
      parents: [folderId],
    };

    // For React Native, we need to read the file and create a multipart upload
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    
    // Read file content
    const fileResponse = await fetch(fileUri);
    const fileBlob = await fileResponse.blob();
    formData.append('file', fileBlob);

    const uploadResponse = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      }
    );

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      throw new Error(`Upload failed: ${error}`);
    }

    const fileResult = await uploadResponse.json();

    // Get web view link
    const fileInfoResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileResult.id}?fields=webViewLink`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const fileInfo = await fileInfoResponse.json();

    return {
      id: fileResult.id,
      webViewLink: fileInfo.webViewLink || `https://drive.google.com/file/d/${fileResult.id}/view`,
    };
  } catch (error) {
    console.error('Google Drive upload error:', error);
    throw error;
  }
}

export async function listBackupsFromGoogleDrive(accessToken: string): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name contains 'bp_backup_' and mimeType='application/json'&spaces=appDataFolder&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to list backups');
    }

    const result = await response.json();
    return result.files || [];
  } catch (error) {
    console.error('List backups error:', error);
    throw error;
  }
}

export async function downloadFromGoogleDrive(accessToken: string, fileId: string): Promise<string> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to download file');
    }

    return await response.text();
  } catch (error) {
    console.error('Download error:', error);
    throw error;
  }
}
