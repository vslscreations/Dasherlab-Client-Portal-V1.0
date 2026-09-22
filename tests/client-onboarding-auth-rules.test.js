const assert = require('assert');

const businessOwnerCreation = require('../js/business-owner-creation.js');

const {
  validateClientAccountInput,
  normalizeClientAccountInput,
  stripClientOverrideFields,
  isPlatformAdminRole,
  isOwnerRole,
  isClientRole
} = businessOwnerCreation;

const validClient = validateClientAccountInput({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '555-123-4567',
  username: 'jane.doe',
  temporaryPassword: 'TempPass123!',
  confirmTemporaryPassword: 'TempPass123!'
});
assert.strictEqual(validClient.ok, true, 'valid client payload should pass validation');

const invalidClient = validateClientAccountInput({
  firstName: '',
  email: 'bad-email',
  username: '',
  temporaryPassword: 'short'
});
assert.strictEqual(invalidClient.ok, false, 'invalid client payload should fail validation');

const overLimitClient = validateClientAccountInput({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '555-123-4567',
  username: 'jane.doe',
  temporaryPassword: 'A'.repeat(73),
  confirmTemporaryPassword: 'A'.repeat(73)
});
assert.strictEqual(overLimitClient.ok, false, 'passwords over 72 characters should fail validation');

const sanitized = normalizeClientAccountInput({
  firstName: ' Jane ',
  lastName: ' Doe ',
  email: 'Jane@Example.com ',
  phone: ' 555-111-2222 ',
  username: '  Jane.Doe  ',
  temporaryPassword: 'TempPass123!',
  confirmTemporaryPassword: 'TempPass123!',
  business_id: 'should-be-ignored',
  role: 'owner',
  password: 'secret',
  status: 'admin',
  user_id: 'abc'
});
assert.strictEqual(sanitized.business_id, undefined, 'browser-supplied business_id should not be retained');
assert.strictEqual(sanitized.role, undefined, 'browser-supplied role should not be retained');
assert.strictEqual(sanitized.password, undefined, 'browser-supplied password should not be retained');
assert.strictEqual(sanitized.user_id, undefined, 'browser-supplied user_id should not be retained');
assert.strictEqual(sanitized.firstName, 'Jane', 'first name should be trimmed');
assert.strictEqual(sanitized.username, 'jane.doe', 'username should be normalized');
assert.strictEqual(sanitized.email, 'Jane@Example.com', 'email should be trimmed but not lowercased unless intentionally normalized');

const rawOverridePayload = {
  firstName: 'Jane',
  email: 'jane@example.com',
  username: 'jane.doe',
  temporaryPassword: 'TempPass123!',
  business_id: 'bad-business',
  role: 'owner',
  password: 'not-allowed',
  user_id: 'abc'
};
const strippedOverridePayload = stripClientOverrideFields(rawOverridePayload);
assert.strictEqual(strippedOverridePayload.business_id, undefined, 'override fields should be removed');
assert.strictEqual(strippedOverridePayload.role, undefined, 'override fields should be removed');
assert.strictEqual(strippedOverridePayload.password, undefined, 'override fields should be removed');
assert.strictEqual(strippedOverridePayload.user_id, undefined, 'user_id override should be removed');
assert.strictEqual(strippedOverridePayload.username, 'jane.doe', 'username should be kept');

assert.strictEqual(isPlatformAdminRole('admin'), true, 'admin role should be recognized');
assert.strictEqual(isOwnerRole('owner'), true, 'owner role should be recognized');
assert.strictEqual(isClientRole('client'), true, 'client role should be recognized');

console.log('Client onboarding authorization tests passed');
