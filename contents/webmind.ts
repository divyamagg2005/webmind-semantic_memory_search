console.log("WebMind Active")

setTimeout(() => {
  const pageData = {
    title: document.title,
    url: window.location.href,
    text: document.body.innerText.slice(0, 5000),
    timestamp: new Date().toISOString()
  }

  chrome.runtime.sendMessage(pageData)

  console.log("Sent page data")
}, 5000)