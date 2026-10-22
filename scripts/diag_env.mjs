// 诊断：直接调用 env.js 的写入函数，验证是否真能写进 HKCU\Environment
import { setEnvVariable, readUserEnv, appendToPath } from '../electron/env.js'

const NAME = 'TEST_LYY_HOME'
const BIN = 'C:\\env-tools-test\\bin'

async function main() {
  console.log('1) 写 HOME 变量 ->', NAME)
  try {
    await setEnvVariable(NAME, 'C:\\env-tools-test')
    const v = await readUserEnv(NAME)
    console.log('   写后读回:', JSON.stringify(v))
  } catch (e) {
    console.log('   失败:', e.message)
  }

  console.log('2) 追加到 Path ->', BIN)
  try {
    const added = await appendToPath(BIN)
    console.log('   追加结果 added =', added)
    const p = await readUserEnv('Path')
    console.log('   Path 是否包含该段:', p.includes(BIN))
  } catch (e) {
    console.log('   失败:', e.message)
  }

  console.log('3) 再次写入同名 HOME（覆盖）')
  try {
    await setEnvVariable(NAME, 'C:\\env-tools-test2')
    const v = await readUserEnv(NAME)
    console.log('   写后读回:', JSON.stringify(v))
  } catch (e) {
    console.log('   失败:', e.message)
  }
}

main()
  .then(() => console.log('=== 诊断结束 ==='))
  .catch((e) => console.log('致命:', e))
