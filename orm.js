const { Sequelize } = require("sequelize");

let sequelizeInstance;
sequelizeInstance = new Sequelize(process.env.DB_URI, {
  dialect: "mysql2",
  logging: false,
});

module.exports = sequelizeInstance;
