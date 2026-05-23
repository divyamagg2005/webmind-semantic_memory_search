console.log("WebMind background worker running")

chrome.runtime.onMessage.addListener(async (message) => {
  console.log("Received from content script:", message)

  try {
    const response = await fetch("http://localhost:3001/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(message)
    })

    const result = await response.text()

    console.log("Sidecar response:", result)
  } catch (err) {
    console.error("Failed to send to sidecar:", err)
  }
})