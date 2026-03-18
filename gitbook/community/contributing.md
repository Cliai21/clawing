# Contributing

CLAWING is an open-source project and welcomes contributions from the community. This guide covers how to contribute code, report issues, suggest features, and participate in the project's development.

---

## Ways to Contribute

| Contribution | Difficulty | Impact |
|---|---|---|
| **Report bugs** | Easy | High |
| **Improve documentation** | Easy | Medium |
| **Submit feature requests** | Easy | Medium |
| **Fix open issues** | Medium | High |
| **Add test coverage** | Medium | High |
| **Implement features** | Hard | High |
| **Security research** | Hard | Critical |

## Getting Started

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/clawing.git
cd clawing
npm install
```

### 2. Create a Branch

```bash
# Use a descriptive branch name
git checkout -b feat/your-feature-name
# or
git checkout -b fix/issue-description
```

### Branch Naming Conventions

| Prefix | Use Case | Example |
|---|---|---|
| `feat/` | New features | `feat/gas-estimation-improvement` |
| `fix/` | Bug fixes | `fix/cooldown-calculation-error` |
| `docs/` | Documentation | `docs/oracle-api-examples` |
| `test/` | Test additions/changes | `test/poaiwmint-edge-cases` |
| `refactor/` | Code refactoring | `refactor/oracle-client-cleanup` |

### 3. Make Changes

Write your code following the [code style guidelines](#code-style) below. Ensure all existing tests pass and add new tests for your changes.

### 4. Test Your Changes

```bash
# Run the full test suite
npm test

# Run specific test file
npm test -- --grep "PoAIWMint"

# Run with coverage
npm run test:coverage
```

All 67 existing tests must pass. New code should include corresponding tests.

### 5. Commit and Push

```bash
git add .
git commit -m "feat: add gas estimation improvement"
git push origin feat/your-feature-name
```

### 6. Open a Pull Request

1. Navigate to the original repository on GitHub
2. Click "New Pull Request"
3. Select your fork and branch
4. Fill in the PR template with:
   - **Summary**: What the PR does and why
   - **Changes**: Specific code changes made
   - **Testing**: How the changes were tested
   - **Related Issues**: Link to any related issues

---

## Code Style

### JavaScript / Node.js

| Rule | Standard |
|---|---|
| Indentation | 2 spaces |
| Semicolons | Required |
| Quotes | Single quotes |
| Line length | 100 characters max |
| Trailing commas | ES5 style |

### Example

```javascript
const { ethers } = require('ethers');

async function getClaimStatus(address) {
  const contract = new ethers.Contract(
    POAIW_MINT_ADDRESS,
    POAIW_MINT_ABI,
    provider
  );

  const cooldown = await contract.getCooldownRemaining(address);
  const claims = await contract.getClaimCount(address, currentEpoch);

  return {
    cooldownBlocks: cooldown.toNumber(),
    claimsUsed: claims.toNumber(),
    canClaim: cooldown.isZero() && claims.lt(MAX_CLAIMS_PER_EPOCH),
  };
}
```

### Solidity

| Rule | Standard |
|---|---|
| Compiler | Solidity ^0.8.20 |
| Style | Solidity style guide |
| NatSpec | Required for all public functions |
| Tests | Foundry or Hardhat |

### Example

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PoAIWMint
/// @notice Manages mining claims and reward distribution
contract PoAIWMint {
    /// @notice Execute a mining claim with Oracle attestation
    /// @param attestation The Oracle-signed attestation data
    /// @param signature The Oracle's ECDSA signature
    /// @return reward The amount of CLAW tokens minted
    function claim(
        bytes calldata attestation,
        bytes calldata signature
    ) external returns (uint256 reward) {
        // Implementation
    }
}
```

---

## Testing Requirements

### Before Submitting a PR

- [ ] All existing tests pass (`npm test`)
- [ ] New features include corresponding test cases
- [ ] Bug fixes include a regression test
- [ ] No test is skipped without documented justification
- [ ] Test coverage does not decrease

### Test Structure

```
tests/
├── unit/
│   ├── claw-token.test.js
│   ├── poaiw-mint.test.js
│   ├── oracle-verifier.test.js
│   └── reward-calculation.test.js
├── integration/
│   ├── mining-flow.test.js
│   ├── oracle-integration.test.js
│   └── governance.test.js
└── helpers/
    ├── fixtures.js
    └── utils.js
```

### Writing Tests

```javascript
describe('PoAIWMint', () => {
  describe('claim', () => {
    it('should mint correct reward after cooldown', async () => {
      // Setup
      const attestation = createMockAttestation(miner.address);
      const signature = await oracle.signAttestation(attestation);

      // Execute
      const tx = await poaiwMint.connect(miner).claim(attestation, signature);

      // Verify
      const balance = await clawToken.balanceOf(miner.address);
      expect(balance).to.be.gt(0);
    });

    it('should revert if cooldown not met', async () => {
      // Claim once, then immediately try again
      await poaiwMint.connect(miner).claim(attestation1, sig1);

      await expect(
        poaiwMint.connect(miner).claim(attestation2, sig2)
      ).to.be.revertedWith('Cooldown not met');
    });
  });
});
```

---

## Issue Reporting

### Bug Reports

When reporting a bug, include:

1. **Description**: Clear summary of the issue
2. **Steps to Reproduce**: Numbered steps to trigger the bug
3. **Expected Behavior**: What should happen
4. **Actual Behavior**: What actually happens
5. **Environment**: OS, Node.js version, npm version
6. **Logs**: Relevant error messages or log output

### Feature Requests

When requesting a feature, include:

1. **Problem**: What problem does this solve?
2. **Proposed Solution**: How should it work?
3. **Alternatives**: Other approaches considered
4. **Impact**: Who benefits and how?

### Security Vulnerabilities

**Do NOT report security vulnerabilities as public issues.**

Instead:
1. Use the GitHub security advisory feature
2. Navigate to [github.com/Cliai21/clawing/security](https://github.com/Cliai21/clawing/security)
3. Include detailed reproduction steps
4. Allow time for a fix before public disclosure

See [Security](../reference/security.md) for the complete vulnerability disclosure process.

---

## Pull Request Guidelines

### PR Checklist

- [ ] Branch is up to date with `main`
- [ ] Code follows the project style guide
- [ ] All tests pass
- [ ] New tests added for new functionality
- [ ] Documentation updated if needed
- [ ] Commit messages are clear and descriptive
- [ ] PR description explains what and why

### Commit Messages

Use conventional commit format:

```
type: short description

Longer explanation if needed. Wrap at 72 characters.
Reference issues with #123.
```

| Type | Use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `test` | Tests |
| `refactor` | Refactoring |
| `chore` | Maintenance |

### Review Process

1. Submit your PR
2. Automated CI runs tests and linting
3. Maintainers review the code
4. Address any feedback
5. PR is merged once approved

---

## Project Structure

```
clawing/
├── contracts/           # Solidity smart contracts
│   ├── CLAW_Token.sol
│   ├── PoAIWMint.sol
│   ├── OracleVerifier.sol
│   └── MinterProxy.sol
├── src/                 # CLI and client source code
│   ├── cli/             # CLI commands (init, status, mine, auto)
│   ├── oracle/          # Oracle client library
│   ├── mining/          # Mining logic
│   └── utils/           # Shared utilities
├── tests/               # Test suite
├── scripts/             # Deployment and utility scripts
├── docs/                # Additional documentation
├── .env.example         # Environment variable template
├── package.json
└── README.md
```

## License

CLAWING is open-source software. Check the repository's `LICENSE` file for the specific license terms. By contributing, you agree that your contributions will be licensed under the same terms.

## Next Steps

- [GitHub Repository](https://github.com/Cliai21/clawing) — Browse the source code
- [FAQ](faq.md) — Common questions
- [Official Links](links.md) — All project resources
- [Architecture](../reference/architecture.md) — Understand the technical design
