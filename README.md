# Unimocks

A library that standardizes API mocking for UI-driven development.

If you've ever done UI-driven development with a requirement for full test automation, then you've probably had to go through the tedium of setting up a mock api server for development, then using mock data in unit testing, then creating mocks for integration testing, and finally creating mock data for contract testing.

Unimocks provides you with an approach that will allow you to use the same mocks for all areas of testing and development.

## Installation

```bash
npm install unimocks
```

## Usage

Unimocks provides several layers of tools to be used for mocking in testing and development.

### Development mocks

The first layer is the `APIService`, it is a class for generating an object that separates the live and mock implementation of your API requests.

First we create an object that defines each of our requests, with their expected output and input formats:

```javascript
export interface UsersAPI extends APIRequests {
  getUsers: APIRequest<User[], void>;
  addUser: APIRequest<User, Partial<User>>;
  updateUser: APIRequest<User, { user: Partial<User>, id: string }>;
  deleteUser: APIRequest<void, string>;
}
```

Then we create our service with the implementation of these requests:

```javascript
export const API = new APIService<UsersAPI>(
	"users",
	{
		getUsers: () => axios.get<User[]>("/api/users").then(({ data }) => data),
		addUser: (user) => axios.post("/api/users", user).then(({ data }) => data),
		updateUser: ({ id, ...user }) => axios.post(`/api/users/${id}`, user).then(({ data }) => data),
		deleteUser: (id) => axios.delete(`/api/users/${id}`),
	},{
		/*dev:start*/ mocks /*dev:end*/,
	}
);
```

- The first argument is the name of our service, it is used to setup interceptors for integration testing, which will be explained later.
- The second argument is the implementation of each request
- The third argument is a list of additional options, currently only our mock implementation. Since the example given is using webpack as our bundler of choice, I've written a small loader to remove this from the production build, though depending on your mocks that may not be necessary.

The mocks object itself is an object of the generic type `APIMocks` which helps us outline strictly typed implementations for our API. In the current example we will be using `factory.ts` and `faker` as our data generation tools.

```javascript
const users = UserFactory.buildList(10);

export const mocks: APIMocks<UsersAPI> = {
	getUsers: () => users,
	addUser: (user) => {
		const newUser = UserFactory.build(user);
		users.push(newUser);
		return newUser;
	},
	updateUser: ({ id, user }) => {
		const originalUser = users.find((u) => u.id === id);
		if (originalUser) {
			Object.keys(user).forEach((key) => {
			(originalUser as any)[key] = (user as any)[key];
			});
		}
		return originalUser as User;
	},
	deleteUser: (id) => {
		const user = users.findIndex((u) => u.id === id);
		if (user !== -1) {
			users.splice(user, 1);
		}
	},
};
```

The upside of this versus using something like `json-server` is how easily we can set it up without running a separate process, how much control we have over the behavior of the mocks and that we have separated the live and dev implementations completely, so no additional changes need to be made to deploy to a live service.

### Integration testing

As mentioned above Unimocks also helps with mocking during integration testing with `puppeteer`. The unique service name we've provided will help the library setup interceptors for our mocked requests.

First thing we need to do is to add another parameter to our service's options to notify that we should be directing our calls to the interceptor, rather than the live or mock implementations. In a webpack CRA scenario it may look something like this:

```javascript
	...
	{
		/*dev:start*/ mocks /*dev:end*/,
		integrationMocks: !!process.env.REACT_APP_INTEGRATION
	}
);
```

To initialize our integration mocks all we need to do is simply call `mockAPI` from the integration layer of the library with our service as a parameter before running any of our tests.

```javascript
import { mockAPI } from 'unimocks/puppeteer';
...
userMocks = await mockAPI(API, page);
```

Not only will this mimic our development mocks to run our integration tests without a live API, it will also give us access to a `ServiceMock` object, which gives us the possibility to:

- View the list of calls to each endpoint, with their inputs and outputs
- Set a custom response for a given endpoint
- Set an error response for a given endpoint
- Or reset the custom implementation back to the default mocks

All of which can be comfortably used to validate that our components both send data correctly and handle the responses appropriately.

### Contract testing

The final layer of Unimocks allows to simplify our contract testing with `pact`. By adding some extra metadata to our request definitions we can simplify the writing of contract tests, and, depending on how we set up our mocks, reuse a lot of that code as well.

The first step is to add some metadata to our request and use the `MetaAPIService` in place of our previous `APIService` class, something like so:

```javascript
new MetaAPIService<UsersAPI>(
	"users",
	{
    getUsers: metaRequest(
      ({ path }) => axios.get<User[]>(`${baseURL}${path}`).then(({ data }) => data),
      { method: "GET", path: `/users` }
    ),
...
```

As this might seem too cumbersome to write, you can easily come up with a utility method depending on your tool of choice for sending HTTP requests.

```javascript
export const usersAPI = (baseURL = defaultBaseURL) =>
  new MetaAPIService() <
  UsersAPI >
  ("users",
  {
    getUsers: axiosRequest({ baseURL, method: "GET", path: `/users` }),
    addUser: axiosRequest({ baseURL, method: "POST", path: `/users`, body: (input) => input }),
    updateUser: axiosRequest({ baseURL, method: "PATCH", path: ({ id }) => `/users/${id}`, body: weedOutFields(["id"]) }),
    deleteUser: axiosRequest({ baseURL, method: "DELETE", path: (id) => `/users/${id}` }),
  },
  {
    /*dev:start*/ mocks /*dev:end*/,
    integrationMocks: !!process.env.REACT_APP_INTEGRATION,
  });
```

Now that we have defined metadata for our requests, we don't need to do it again in our contract tests, but instead use the interaction builder by creating one before the tests.

```javascript
const client = usersAPI(provider.mockService.baseUrl);
const interactions = setupInteractionBuilders(client);
```

> **_NOTE:_** In case you are using random data generation it is highly advised to mock out your data generators to something that does not generate random data, as this will cause pact to have to revalidate your contracts every time.

Now that we have our interactions builder set up, we can use it to write short and simple specs that will generate our contracts.

```javascript
const { interaction, output } = await interactions.getUsers({
  state: "Server is healthy",
  uponReceiving: "a GET request for the list of users",
  input: undefined,
});
await provider.addInteraction(interaction);
expect(await client.requests.getUsers()).toEqual(output);
```

Since every part of the interaction can be overridden via the builder's request arguments, you have as much freedom as you would using pact directly.

> **_NOTE:_** The current process of generating matchers based on the mock outputs is fairly primitive. I am planning to update it once pact-js gets v3 specification support. Until then make sure your contracts are generated the way you intended.

## License

[ISC](https://choosealicense.com/licenses/isc/)
