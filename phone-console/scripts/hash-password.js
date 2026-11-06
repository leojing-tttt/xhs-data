import { hashPassword } from '../server/auth.js';

const [username, password, displayName] = process.argv.slice(2);
if (!username || !password) {
  console.error('用法: node scripts/hash-password.js <用户名> <密码> [显示名]');
  process.exit(1);
}

const record = {
  username,
  displayName: displayName || username,
  password: hashPassword(password),
};
console.log(JSON.stringify(record, null, 2));
