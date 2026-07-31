/** Create goes through a validating action, not the core route: the core
 *  create would accept any field on the type, and events are annotations the
 *  whole team writes onto a shared chart. Edit/delete stay in the admin panel —
 *  Pulse doesn't duplicate CRUD UI, it captures the one moment (reading the
 *  trend) where writing an annotation is the natural thing to do. */
export default {
  routes: [{ method: 'POST', path: '/events', handler: 'event.add', config: { policies: [] } }],
}
