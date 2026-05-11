export interface JeanWebBuildInfo {
  webBuildId: string
  appVersion: string
  gitSha?: string
  builtAt?: string
}

declare const __JEAN_WEB_BUILD_INFO__: JeanWebBuildInfo | undefined

const FALLBACK_BUILD_INFO: JeanWebBuildInfo = {
  webBuildId: 'unknown',
  appVersion: '0.0.0',
}

export const CLIENT_BUILD_INFO: JeanWebBuildInfo =
  typeof __JEAN_WEB_BUILD_INFO__ !== 'undefined'
    ? __JEAN_WEB_BUILD_INFO__
    : FALLBACK_BUILD_INFO

export const CLIENT_WEB_BUILD_ID = CLIENT_BUILD_INFO.webBuildId
