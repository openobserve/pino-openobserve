import OpenobserveTransport from "../src/index";

describe("OpenobserveTransport", () => {
  /**
   * Valid options for the OpenobserveTransport
   * @property {string} url The url of the OpenObserve API
   * @property {string} organization The name of the organization
   * @property {string} streamName The name of the stream
   * @property {AuthOptions} auth The options for the basic auth
   */
  const validOptions = {
    url: "http://mockurl.com",
    organization: "test-org",
    streamName: "test-stream",
    auth: { username: "test-user", password: "test-pass" },
  };

  /**
   * The instance of the OpenobserveTransport class
   */
  let transport: OpenobserveTransport;

  /**
   * This method is called before each test. It resets the mocks and
   * initializes a new instance of the OpenobserveTransport class with
   * the valid options.
   */
  beforeEach(() => {
    jest.clearAllMocks();
    transport = new OpenobserveTransport(validOptions); // Ensure transport is initialized here
  });

  /**
   * This method is called after each test. It clears all timers and
   * calls the destroy method of the OpenobserveTransport class to
   * ensure that any timers and event listeners are cleaned up.
   */
  afterEach(() => {
    jest.clearAllTimers(); // Clear timers after each test
    transport.destroy(); // Call the destroy method
  });

  /**
   * Test case to verify that an error is thrown when required options are missing.
   * The OpenobserveTransport constructor should raise an error if 'url', 'organization',
   * or 'streamName' are not provided in the options.
   */
  it("should throw an error if required options are missing", () => {
    // Attempt to instantiate OpenobserveTransport with missing options
    expect(() => {
      new OpenobserveTransport({} as any); // This should cause an error due to missing required fields
    }).toThrow("OpenObserve Pino: Missing required options: url, organization, or streamName");
  });

  /**
   * This test case verifies that an error is thrown when the required 'organization'
   * option is missing. The test creates an instance of the OpenobserveTransport class
   * with an options object that is missing the 'organization' field.
   */
  it("should throw an error if required options are missing (organization)", () => {
    // Test for missing 'organization' option
    const incompleteOptions = { ...validOptions, organization: "" };

    expect(() => {
      new OpenobserveTransport(incompleteOptions); // Instantiate the class
    }).toThrow("OpenObserve Pino: Missing required options: url, organization, or streamName");
  });

  /**
   * Test case to verify that an error is thrown when the required 'streamName'
   * option is missing. The test creates an instance of the OpenobserveTransport class
   * with an options object that is missing the 'streamName' field.
   */
  it("should throw an error if required options are missing (streamName)", () => {
    // Test for missing 'streamName' option
    const incompleteOptions = { ...validOptions, streamName: "" };

    // Attempt to instantiate OpenobserveTransport with missing 'streamName' option
    expect(() => {
      new OpenobserveTransport(incompleteOptions); // Instantiate the class
    }).toThrow("OpenObserve Pino: Missing required options: url, organization, or streamName");
  });

  /**
   * Verifies that the OpenobserveTransport class initializes with default options
   * when only the required options are provided.
   */
  it("should initialize with default options", () => {
    const transportWithDefaults = new OpenobserveTransport(validOptions);

    // Verify that the class instantiated successfully
    expect(transportWithDefaults).toBeTruthy();

    // Verify the default values for the options that are not provided
    expect((transportWithDefaults as any).options.batchSize).toBe(100);
    expect((transportWithDefaults as any).options.timeThreshold).toBe(300000);
    expect((transportWithDefaults as any).options.silentSuccess).toBe(false);
    expect((transportWithDefaults as any).options.silentError).toBe(false);
  });

  /**
   * Verifies that the OpenobserveTransport class correctly creates the API URL
   * during initialization.
   */
  it("should correctly create API URL", () => {
    // Spy on the private 'createApiUrl' method to check if it was called
    const spyCreateApiUrl = jest.spyOn(OpenobserveTransport.prototype as any, "createApiUrl");

    // Instantiate the class
    transport = new OpenobserveTransport(validOptions);

    // Verify that the private method was called
    expect(spyCreateApiUrl).toHaveBeenCalled();
  });

  /**
   * Verifies that the OpenobserveTransport class pushes logs to the internal buffer
   * on _transform and calls scheduleSendLogs.
   */
  it("should push logs to buffer on _transform and call scheduleSendLogs", async () => {
    // Use fake timers to control async behavior
    jest.useFakeTimers();

    // Mock a successful response
    // Mock the fetch response
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ successful: 1 }), {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
    );

    // Spy on the 'scheduleSendLogs' method to check if it was called
    const scheduleSendLogsSpy = jest.spyOn(transport as any, "scheduleSendLogs");

    // Mock the callback passed to _transform
    const callback = jest.fn();

    // Simulate calling _transform and passing a callback
    transport._transform({ message: "test log" }, "utf-8", callback);

    // Wait for any promises to resolve
    await Promise.resolve(); // Wait for any microtasks to complete

    // Check if the log was pushed into the internal buffer (logs array)
    expect(transport["logs"]).toHaveLength(1);

    // Fast-forward all timers to 5 minutes in the future
    jest.advanceTimersByTime(5 * 60 * 1000);

    // Ensure 'scheduleSendLogs' was called after _transform
    expect(scheduleSendLogsSpy).toHaveBeenCalledTimes(1);

    // Verify that the callback was called
    expect(callback).toHaveBeenCalled();
  });

  /**
   * Verifies that the OpenobserveTransport class sends logs immediately if the buffer size
   * exceeds the batch size.
   */
  it("should send logs immediately if buffer exceeds batch size", async () => {
    jest.useFakeTimers();

    // Mock a successful response
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ successful: 1 }), {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
    );

    // Spy on the 'sendLogs' method to check if it was called
    const sendLogsSpy = jest.spyOn(transport as any, "sendLogs");

    // Push logs to the internal buffer until it exceeds the batch size
    transport["logs"] = new Array(100).fill("log");

    // Call scheduleSendLogs which should call sendLogs since the buffer size exceeds the batch size
    transport["scheduleSendLogs"]();

    // Verify that the sendLogs method was called
    expect(sendLogsSpy).toHaveBeenCalled();
  });

  /**
   * Test case to verify that logs are not sent if apiCallInProgress is true or logs array is empty.
   * Ensures that the sendLogs method does not make a fetch call under these conditions.
   */
  it("should not send logs if apiCallInProgress or logs are empty", async () => {
    // Mock the fetch function to simulate a successful API response
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ successful: 1 }), {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
    );

    const fetchMock = fetch as jest.MockedFunction<typeof fetch>;

    // Set apiCallInProgress to true and attempt to send logs
    // Expect fetch not to be called due to apiCallInProgress being true
    transport["apiCallInProgress"] = true;
    await transport["sendLogs"]();
    expect(fetchMock).not.toHaveBeenCalled();

    // Set apiCallInProgress to false and logs array to empty
    // Attempt to send logs and expect fetch not to be called due to empty logs array
    transport["apiCallInProgress"] = false;
    transport["logs"] = [];
    await transport["sendLogs"]();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Test case to verify that logs are sent to the OpenObserve API and
   * that a success message is logged if the response is OK.
   */
  it("should send logs and log success if response is ok", async () => {
    // Use fake timers to control async behavior
    jest.useFakeTimers();

    // Mock the fetch function to simulate a successful API response
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ successful: 1 }), {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
    );

    // Store the mock fetch function in a variable
    const fetchMock = fetch as jest.MockedFunction<typeof fetch>;

    // Mock the response of the fetch function to simulate a successful response
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusText: "ok" }), { status: 200 })
    );

    // Mock the console.log function to verify that it is called
    console.log = jest.fn();

    // Set the internal logs array to contain two logs
    transport["logs"] = ["log1", "log2"];

    // Call the sendLogs method to send the logs to the OpenObserve API
    await transport["sendLogs"]();

    // Verify that the fetch function was called with the correct arguments
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        body: "log1log2",
      })
    );

    // Verify that the console.log function was called with a success message
    expect(console.log).toHaveBeenCalledWith("successful: ", { statusText: "ok" });
  });

  /**
   * Test case to verify that an error is logged to the console if sending
   * logs to the OpenObserve API fails and the silentError option is false.
   */
  it("should log error if send fails and silentError is false", async () => {
    // Use fake timers to control async behavior
    jest.useFakeTimers();

    // Mock the fetch function to simulate a successful API response
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ successful: 1 }), {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
    );

    // Store the mock fetch function in a variable
    const fetchMock = fetch as jest.MockedFunction<typeof fetch>;

    // Mock the response of the fetch function to simulate a network error
    fetchMock.mockRejectedValue(new Error("Network error"));

    // Mock the console.error function to verify that it is called
    console.error = jest.fn();

    // Set the internal logs array to contain one log
    transport["logs"] = ["log1"];

    // Call the sendLogs method to send the logs to the OpenObserve API
    await transport["sendLogs"]();

    // Verify that the console.error function was called with an error message
    expect(console.error).toHaveBeenCalledWith("Failed to send logs:", expect.any(Error));
  });

  /**
   * Test case to verify that the silentSuccess and silentError options are respected.
   * Logs should not be printed to the console when these options are set to true.
   */
  it("should respect silentSuccess and silentError options", async () => {
    // Cast fetch as a mocked function and set up a successful response
    const fetchMock = fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusText: "ok" }), { status: 200 })
    );

    // Mock console.log and console.error to verify their calls
    console.log = jest.fn();
    console.error = jest.fn();

    // Create an instance of OpenobserveTransport with silentSuccess and silentError enabled
    const silentTransport = new OpenobserveTransport({
      ...validOptions,
      silentSuccess: true,
      silentError: true,
    });

    // Set the logs array and call sendLogs
    silentTransport["logs"] = ["log1"];
    await silentTransport["sendLogs"]();

    // Verify that console.log was not called due to silentSuccess being true
    expect(console.log).not.toHaveBeenCalled();

    // Set up fetch to simulate a network error
    fetchMock.mockRejectedValue(new Error("Network error"));

    // Set the logs array and call sendLogs
    silentTransport["logs"] = ["log2"];
    await silentTransport["sendLogs"]();

    // Verify that console.error was not called due to silentError being true
    expect(console.error).not.toHaveBeenCalled();
  });

  /**
   * Test case to verify that a non-200 response status is handled as an error.
   * The console.error function should be called with the error message and status code.
   */
  it("should handle non-200 response status as error", async () => {
    jest.useFakeTimers();

    // Mock the fetch function to simulate a 500 Internal Server Error response
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ failed: 1 }), {
          status: 500,
          statusText: "Internal Server Error",
          headers: {
            "Content-Type": "application/json",
          },
        })
      )
    );

    const fetchMock = fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue(
      new Response(null, { status: 500, statusText: "Internal Server Error" })
    );
    // Mock the console.error function to verify that it is called
    console.error = jest.fn();

    // Set the logs array and call sendLogs
    transport["logs"] = ["log1"];
    await transport["sendLogs"]();

    // Verify that console.error was called with the error message and status code
    expect(console.error).toHaveBeenCalledWith(
      "Failed to send logs:",
      500,
      "Internal Server Error"
    );
  });
});
