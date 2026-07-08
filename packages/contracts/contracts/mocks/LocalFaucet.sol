// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract LocalFaucet {
    address public owner;
    uint256 public nativeAmount;
    address[] public tokens;
    mapping(address => uint256) public tokenAmounts;
    mapping(address => bool) public tokenConfigured;

    bool private locked;

    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event NativeAmountUpdated(uint256 amount);
    event TokenAmountUpdated(address indexed token, uint256 amount);
    event Claimed(address indexed account, uint256 nativeAmount);
    event TokenClaimed(address indexed account, address indexed token, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "LocalFaucet: not owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "LocalFaucet: reentrant");
        locked = true;
        _;
        locked = false;
    }

    constructor(address owner_, uint256 nativeAmount_) payable {
        require(owner_ != address(0), "LocalFaucet: zero owner");
        owner = owner_;
        nativeAmount = nativeAmount_;
        emit OwnerUpdated(address(0), owner_);
        emit NativeAmountUpdated(nativeAmount_);
    }

    receive() external payable {}

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "LocalFaucet: zero owner");
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    function setNativeAmount(uint256 amount) external onlyOwner {
        nativeAmount = amount;
        emit NativeAmountUpdated(amount);
    }

    function setTokenAmount(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "LocalFaucet: zero token");
        if (!tokenConfigured[token] && amount > 0) {
            tokenConfigured[token] = true;
            tokens.push(token);
        }
        tokenAmounts[token] = amount;
        emit TokenAmountUpdated(token, amount);
    }

    function claimAll() external nonReentrant {
        _claimNative(msg.sender);
        uint256 length = tokens.length;
        for (uint256 index = 0; index < length; index++) {
            _claimToken(msg.sender, tokens[index]);
        }
    }

    function claimNative() external nonReentrant {
        _claimNative(msg.sender);
    }

    function claimToken(address token) external nonReentrant {
        _claimToken(msg.sender, token);
    }

    function _claimNative(address account) internal {
        if (nativeAmount == 0) return;
        require(address(this).balance >= nativeAmount, "LocalFaucet: native empty");
        (bool ok, ) = payable(account).call{ value: nativeAmount }("");
        require(ok, "LocalFaucet: native transfer failed");
        emit Claimed(account, nativeAmount);
    }

    function _claimToken(address account, address token) internal {
        uint256 amount = tokenAmounts[token];
        if (amount == 0) return;
        (bool ok, bytes memory data) = token.call(abi.encodeWithSignature("transfer(address,uint256)", account, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "LocalFaucet: token transfer failed");
        emit TokenClaimed(account, token, amount);
    }
}
