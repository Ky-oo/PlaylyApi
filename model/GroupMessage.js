const { DataTypes } = require("sequelize");

const sequelize = require("../orm");

const GroupMessage = sequelize.define("GroupMessage", {
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: "text",
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  edited_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  send_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
});

module.exports = GroupMessage;
