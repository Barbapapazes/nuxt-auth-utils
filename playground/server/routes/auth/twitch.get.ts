export default oauthTwitchEventHandler({
  config: {
    emailRequired: true,
  },
  async onSuccess(event, { user }) {
    await setUserSession(event, {
      user: {
        twitch: user.nickname,
      },
      loggedInAt: Date.now(),
    })

    return sendRedirect(event, '/')
  },
})
