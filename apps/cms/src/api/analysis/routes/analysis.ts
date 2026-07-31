/** Classification controls. Deliberately its own api folder rather than bolted
 *  onto muted-author: muting is about an AUTHOR, classification is about the
 *  corpus, and conflating them in one Settings card made "Rescan history" read
 *  as if it re-ran analysis. */
export default {
  routes: [
    { method: 'GET', path: '/analysis/status', handler: 'analysis.status', config: { policies: [] } },
    { method: 'POST', path: '/analysis/reclassify', handler: 'analysis.reclassify', config: { policies: [] } },
  ],
}
