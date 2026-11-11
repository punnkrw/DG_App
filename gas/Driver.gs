// Driver actions. Identity always comes from the verified ID token.

// Works for any LINE user, so the page can show "not registered" or "waiting for approval".
function driverMe_(req) {
  const user = requireUser_(req);
  const d = findDriver_(user.userId);
  return {
    userId: user.userId,
    lineName: user.name,
    driver: d ? { driverCode: String(d.DriverCode), name: d.Name, status: d.Status } : null,
  };
}
