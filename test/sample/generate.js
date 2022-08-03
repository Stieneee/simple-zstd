const fs = require('fs');
const mocker = require('mocker-data-generator').default;

const user = {
  firstName: {
    faker: 'name.firstName',
  },
  lastName: {
    faker: 'name.lastName',
  },
  country: {
    faker: 'address.country',
  },
  createdAt: {
    faker: 'date.past',
  },
  username: {
    function() {
      return (
        this.object.lastName.substring(0, 5)
              + this.object.firstName.substring(0, 3)
              + Math.floor(Math.random() * 10)
      );
    },
  },
};

for (let i = 0; i < 150; i += 1) {
  // write fake user to file
  const userData = mocker(user);
  const userJson = JSON.stringify(userData);
  fs.writeFileSync(`./training-files/user-${i}.json`, userJson);
}
