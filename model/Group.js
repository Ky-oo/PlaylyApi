const { DataTypes } = require("sequelize");

const sequelize = require("../orm");

const Group = sequelize.define("Group", {
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  cover_img_url: {
    type: DataTypes.STRING(512),
    allowNull: true,
  },
  is_public: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
});

module.exports = Group;
