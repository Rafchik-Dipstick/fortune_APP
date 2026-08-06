const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withGameCenter(config) {
  return withEntitlementsPlist(config, (configured) => {
    configured.modResults['com.apple.developer.game-center'] = true;
    return configured;
  });
};
