'use strict';
/* Which class (department + level) something belongs to, and what a class rep may manage. */

// An item with no department or level belongs to everyone. Level 0 means "every level".
function classMatch(item, user) {
  if (!item) return false;
  if (!user) return !item.departmentId && !item.level;
  return (!item.departmentId || item.departmentId === user.departmentId) && (!item.level || Number(item.level) === Number(user.level));
}
const repScope = (user) => (user && user.rep && user.rep.departmentId ? { departmentId: user.rep.departmentId, level: Number(user.rep.level) || 0 } : null);
// Is this course part of the class a rep looks after?
function courseInScope(course, scope) {
  if (!course || !scope) return false;
  const deptOk = !course.departmentIds || !course.departmentIds.length || course.departmentIds.includes(scope.departmentId);
  return deptOk && (!scope.level || course.level === scope.level);
}
module.exports = { classMatch, repScope, courseInScope };
