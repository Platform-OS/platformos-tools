const path = require('path');
const PRODUCTION = process.env.NODE_ENV === 'production';

module.exports = {
  entry: path.resolve(__dirname, 'dist', 'index.js'),
  mode: PRODUCTION ? 'production' : 'development',
  devtool: PRODUCTION ? undefined : 'inline-source-map',
  output: {
    filename: 'standalone.js',
    path: __dirname,
    globalObject: 'this',
    library: {
      name: 'prettierPluginLiquid',
      type: 'umd',
    },
  },
  externals: {
    prettier: {
      commonjs: 'prettier',
      commonjs2: 'prettier',
      amd: 'prettier/standalone',
      root: 'prettier',
    },
  },
  optimization: {
    minimize: PRODUCTION ? true : false,
  },
  node: {
    __dirname: true,
  },
  experiments: {
    // We bundle the compiled `dist/` output. Webpack's built-in TypeScript
    // support would otherwise resolve imports back to sibling `.ts` sources and
    // strip them in strip-only mode, which cannot handle `enum`.
    typescript: false,
  },
};
