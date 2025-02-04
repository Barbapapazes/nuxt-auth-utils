export default oauth.githubEventHandler({
  async onSuccess(event, { user }) {
    await setUserSession(event, {
      user: {
        github: user,
      }
    })

    return sendRedirect(event, '/')
  }
})
