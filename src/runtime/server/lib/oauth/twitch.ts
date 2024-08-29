import type { H3Event, EventHandler } from 'h3'
import { eventHandler, createError, getQuery, getRequestURL, sendRedirect } from 'h3'
import { withQuery, parsePath } from 'ufo'
import { defu } from 'defu'
import { useRuntimeConfig } from '#imports'
import type { OAuthAccessTokenError, OAuthAccessTokenSuccess, OAuthConfig, OAuthToken, OAuthUser } from '#auth-utils'

/**
 * Twitch User
 *
 * @see https://dev.twitch.tv/docs/api/reference/#get-users
 */
type TwitchUser = {
  id: string
  login: string
  display_name: string
  profile_image_url: string
  email?: string
}

export interface OAuthTwitchConfig {
  /**
   * Twitch Client ID
   * @default process.env.NUXT_OAUTH_TWITCH_CLIENT_ID
   */
  clientId?: string

  /**
   * Twitch OAuth Client Secret
   * @default process.env.NUXT_OAUTH_TWITCH_CLIENT_SECRET
   */
  clientSecret?: string

  /**
   * Twitch OAuth Scope
   * @default []
   * @see https://dev.twitch.tv/docs/authentication/scopes
   * @example ['user:read:email']
   */
  scope?: string[]

  /**
   * Require email from user, adds the ['user:read:email'] scope if not present
   * @default false
   */
  emailRequired?: boolean

  /**
   * Twitch OAuth Authorization URL
   * @default 'https://id.twitch.tv/oauth2/authorize'
   */
  authorizationURL?: string

  /**
   * Twitch OAuth Token URL
   * @default 'https://id.twitch.tv/oauth2/token'
   */
  tokenURL?: string

  /**
   * Extra authorization parameters to provide to the authorization URL
   * @see https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow
   * @example { force_verify: 'true' }
   */
  authorizationParams?: Record<string, string>
  /**
   * Redirect URL to to allow overriding for situations like prod failing to determine public hostname
   * @default process.env.NUXT_OAUTH_TWITCH_REDIRECT_URL or current URL
   */
  redirectURL?: string
}

export function oauthTwitchEventHandler({ config, onSuccess, onError }: OAuthConfig<OAuthTwitchConfig, TwitchUser>): EventHandler {
  return eventHandler(async (event: H3Event) => {
    config = defu(config, useRuntimeConfig(event).oauth?.twitch, {
      authorizationURL: 'https://id.twitch.tv/oauth2/authorize',
      tokenURL: 'https://id.twitch.tv/oauth2/token',
      authorizationParams: {},
    }) as OAuthTwitchConfig
    const { code } = getQuery(event)

    if (!config.clientId) {
      const error = createError({
        statusCode: 500,
        message: 'Missing NUXT_OAUTH_TWITCH_CLIENT_ID env variables.',
      })
      if (!onError) throw error
      return onError(event, error)
    }

    const redirectURL = config.redirectURL || getRequestURL(event).href
    if (!code) {
      config.scope = config.scope || []
      if (config.emailRequired && !config.scope.includes('user:read:email')) {
        config.scope.push('user:read:email')
      }
      // Redirect to Twitch Oauth page
      return sendRedirect(
        event,
        withQuery(config.authorizationURL as string, {
          response_type: 'code',
          client_id: config.clientId,
          redirect_uri: redirectURL,
          scope: config.scope.join(' '),
          ...config.authorizationParams,
        }),
      )
    }

    const tokens: any = await $fetch<unknown>(
      config.tokenURL as string,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        params: {
          grant_type: 'authorization_code',
          redirect_uri: parsePath(redirectURL).pathname,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
        },
      },
    ).catch((error) => {
      return { error }
    })
    if ((tokens as OAuthAccessTokenError).error) {
      const error = createError({
        statusCode: 401,
        message: `Twitch login failed: ${(tokens as OAuthAccessTokenError).error || 'Unknown error'}`,
        data: tokens as OAuthAccessTokenError,
      })
      if (!onError) throw error
      return onError(event, error)
    }

    const accessToken = (tokens as OAuthAccessTokenSuccess).access_token

    const users = await $fetch<{ data: TwitchUser[] }>('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-ID': config.clientId,
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    const user = users.data?.[0]

    if (!user) {
      const error = createError({
        statusCode: 500,
        message: 'Could not get Twitch user',
        data: tokens,
      })
      if (!onError) throw error
      return onError(event, error)
    }

    return onSuccess(event, {
      user: normalizeTwitchUser(user),
      tokens: normalizeTwitchTokens(tokens),
    })
  })
}

function normalizeTwitchUser(user: TwitchUser): OAuthUser<TwitchUser> {
  return {
    id: user.id,
    nickname: user.login,
    name: user.display_name,
    email: user.email,
    avatar: user.profile_image_url,
    raw: user,
  }
}

function normalizeTwitchTokens(tokens: TwitchAccessTokenSucces): OAuthToken {
  return {
    token: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    approvedScopes: tokens.scope || [],
  }
}
 
/**
  * Authorization Tokens
  * @see https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#use-the-authorization-code-to-get-a-token
  */
interface TwitchAccessTokenSucces extends Omit<OAuthAccessTokenSuccess, 'scope'> {
  scope?: string[]
}