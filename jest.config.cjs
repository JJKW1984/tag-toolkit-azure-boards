const extensionProject = {
  displayName: "extension",
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  setupFilesAfterEnv: ["<rootDir>/src/test/setupTests.ts"],
  testMatch: ["**/?(*.)+(spec|test).+(ts|tsx)"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  moduleNameMapper: {
    "\\.(css|scss)$": "identity-obj-proxy",
    "\\.(png|jpg|jpeg|gif|svg)$": "<rootDir>/src/test/mocks/fileMock.js",
    "^azure-devops-ui/.+$": "<rootDir>/src/test/mocks/modules/azureDevopsUi.tsx",
    "^azure-devops-extension-api/WorkItemTracking$": "<rootDir>/src/test/mocks/modules/azureDevopsApiWorkItemTracking.ts",
    "^azure-devops-extension-api/Core/CoreClient$": "<rootDir>/src/test/mocks/modules/azureDevopsApiCoreClient.ts",
    "^azure-devops-extension-api/Common/CommonServices$": "<rootDir>/src/test/mocks/modules/azureDevopsApiCommonServices.ts"
  },
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.test.json"
      }
    ]
  }
};

const liveTestProject = {
  displayName: "live-test",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/live-test"],
  // Deliberately NOT matching *.spec.ts: Phase 2 puts Playwright specs under
  // live-test/ui/specs, and Jest must never try to run those.
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.live-test.json"
      }
    ]
  }
};

module.exports = {
  projects: [extensionProject, liveTestProject],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "live-test/**/*.ts",
    "!src/**/*.d.ts",
    "!src/test/**",
    "!live-test/test/**"
  ],
  coverageReporters: ["text", "lcov", "cobertura"],
  coverageDirectory: "coverage",
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "test-results",
        outputName: "junit.xml"
      }
    ]
  ]
};
