const path = require('path');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = {
  target: 'node',
  mode: 'production',
  entry: {
    index: './src/index.ts',
    puppeteer: './src/puppeteer.ts',
    pact: './src/pact.ts',
  },
  devtool: 'inline-source-map',
  module: {
    rules: [
      {
        test: /\.(ts|js)?$/,
        exclude: /node_modules/,
        use: [{
          loader: 'babel-loader',
        }, {
          loader: 'ts-loader',
        }]
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  externals: {
    puppeteer: 'puppeteer',
    '@pact-foundation/pact': '@pact-foundation/pact',
  },
  plugins: [
    new BundleAnalyzerPlugin()
  ],
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    library: {
      name: 'pompeteer',
      type: 'umd',
    },
    clean: true,
  },
  optimization: {
    usedExports: true,
    sideEffects: true,
    innerGraph: true,
    splitChunks: {
      chunks: 'all'
    }
  }
};
