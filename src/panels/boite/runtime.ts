// What the daemon's composition root needs to register the boite type: its
// definition only, the daemon serves it a stateless session.

import boiteDefinition from './definition'

export function boitePanel() {
  return { definition: boiteDefinition }
}
