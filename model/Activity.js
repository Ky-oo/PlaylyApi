const { DataTypes } = require("sequelize");

const sequelize = require("../orm");

const Activity = sequelize.define(
  "Activity",
  {
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    gameId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    city: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    postalCode: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    latitude: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
    },
    longitude: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
    },
    place_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    seats: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    homeHost: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0,
    },
    private: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    hostUserId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    hostOrganisationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    groupId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    chatId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    playersId: {
      type: DataTypes.VIRTUAL,
      get() {
        const users = this.get("users");
        if (!users) return [];
        return users.map((user) => user.id);
      },
    },
    hostType: {
      type: DataTypes.VIRTUAL,
      get() {
        const org = this.get("hostOrganisation");
        const hostUser = this.get("hostUser");
        if (org) return "organisation";
        if (hostUser) return "user";
        return null;
      },
    },
    hostId: {
      type: DataTypes.VIRTUAL,
      get() {
        const org = this.get("hostOrganisation");
        const hostUser = this.get("hostUser");
        if (org) return org.id;
        if (hostUser) return hostUser.id;
        return null;
      },
    },
  },
  {
    validate: {
      // Ensure exactly one host is set
      hasExactlyOneHost() {
        const hostType = this.getDataValue("hostType");
        if (!this.hostUserId && !this.hostOrganisationId) {
          if (hostType === "event") {
            return;
          }
          throw new Error("Activity requires a host (user or organisation).");
        }
        if (this.hostUserId && this.hostOrganisationId) {
          throw new Error(
            "Activity cannot have both a user and organisation host.",
          );
        }
      },
    },
  },
);

module.exports = Activity;
