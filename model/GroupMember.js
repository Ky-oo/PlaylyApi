const { DataTypes } = require("sequelize");

const sequelize = require("../orm");

const GroupMember = sequelize.define("GroupMember", {
  role: {
    type: DataTypes.ENUM("owner", "admin", "member"),
    allowNull: false,
    defaultValue: "member",
  },
  joined_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
});

module.exports = GroupMember;
