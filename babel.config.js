module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    overrides: [
      {
        test: /\.(ts|tsx)$/,
        plugins: [
          ["@babel/plugin-transform-typescript", { allowDeclareFields: true }],
        ],
      },
      {
        exclude: /node_modules/,
        plugins: [
          ["@babel/plugin-transform-private-methods", { loose: true }],
          [
            "@babel/plugin-transform-private-property-in-object",
            { loose: true },
          ],
          "@babel/plugin-transform-logical-assignment-operators",
          "@babel/plugin-transform-nullish-coalescing-operator",
          "@babel/plugin-transform-optional-chaining",
        ],
      },
      {
        plugins: ["react-native-reanimated/plugin"],
      },
    ],
  };
};
