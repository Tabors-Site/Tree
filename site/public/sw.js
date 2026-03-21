self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: "Tree", body: event.data ? event.data.text() : "New notification" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Tree", {
      body: data.body || "",
      icon: "/tree.png",
      badge: "/tree.png",
      data: { type: data.type || "general" },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
