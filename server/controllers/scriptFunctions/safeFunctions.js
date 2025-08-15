//prebuilt functions to use in scripts

async function getApi(url) {
  const blockedHosts = [
    "127.0.0.1",
    "localhost",
    "10.",
    "192.168.",
    ".tabors.site",
  ];
  const host = new URL(url).hostname;

  if (blockedHosts.some((b) => host.startsWith(b))) {
    throw new Error("Local IPs are blocked");
  }

  const res = await axios.get(url);
  return res.data;
}

module.exports = { getApi };
