export const SAMPLE_CODE = `async function loadUser() {
  const user = await fetchUser()

  if (user.isActive) {
    goToDashboard()
  } else {
    showInactiveMessage()
  }
}`
