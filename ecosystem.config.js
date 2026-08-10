module.exports = {
  apps: [
    {
      name: "umrflix",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      instances: "max", // Uses available CPU cores
      exec_mode: "cluster",
      env: {
        PORT: 3000,
        NODE_ENV: "production",
      },
    },
  ],
};