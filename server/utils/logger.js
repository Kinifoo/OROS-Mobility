const colors = {
  reset:'\x1b[0m', cyan:'\x1b[36m', green:'\x1b[32m',
  yellow:'\x1b[33m', red:'\x1b[31m', gray:'\x1b[90m', blue:'\x1b[34m'
};
const ts = () => new Date().toISOString().replace('T',' ').substring(0,19);
module.exports = {
  info:  (m) => console.log(`${colors.gray}${ts()}${colors.reset} ${colors.green}INFO ${colors.reset} ${m}`),
  warn:  (m) => console.log(`${colors.gray}${ts()}${colors.reset} ${colors.yellow}WARN ${colors.reset} ${m}`),
  error: (m) => console.log(`${colors.gray}${ts()}${colors.reset} ${colors.red}ERR  ${colors.reset} ${m}`),
  tcp:   (m) => console.log(`${colors.gray}${ts()}${colors.reset} ${colors.cyan}TCP  ${colors.reset} ${m}`),
  http:  (m) => console.log(`${colors.gray}${ts()}${colors.reset} ${colors.blue}HTTP ${colors.reset} ${m}`),
  debug: (m) => process.env.NODE_ENV !== 'production' && console.log(`${colors.gray}${ts()} DBG  ${m}${colors.reset}`),
};
