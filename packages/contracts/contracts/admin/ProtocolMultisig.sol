// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ProtocolMultisig {
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
    }

    address[] private ownerList;
    mapping(address => bool) public isOwner;
    uint256 public immutable threshold;
    Transaction[] private transactions;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    event Deposit(address indexed sender, uint256 amount);
    event TransactionSubmitted(uint256 indexed txId, address indexed owner, address indexed to, uint256 value, bytes data);
    event TransactionConfirmed(uint256 indexed txId, address indexed owner);
    event TransactionRevoked(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "ProtocolMultisig: not owner");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactions.length, "ProtocolMultisig: tx missing");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!transactions[txId].executed, "ProtocolMultisig: executed");
        _;
    }

    constructor(address[] memory owners_, uint256 threshold_) {
        require(owners_.length > 0, "ProtocolMultisig: no owners");
        require(threshold_ > 0 && threshold_ <= owners_.length, "ProtocolMultisig: bad threshold");

        for (uint256 index = 0; index < owners_.length; index++) {
            address owner = owners_[index];
            require(owner != address(0), "ProtocolMultisig: zero owner");
            require(!isOwner[owner], "ProtocolMultisig: duplicate owner");
            isOwner[owner] = true;
            ownerList.push(owner);
        }

        threshold = threshold_;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    function getOwners() external view returns (address[] memory) {
        return ownerList;
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getTransaction(uint256 txId) external view txExists(txId) returns (Transaction memory) {
        return transactions[txId];
    }

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256 txId) {
        require(to != address(0), "ProtocolMultisig: zero target");
        txId = transactions.length;
        transactions.push(Transaction({ to: to, value: value, data: data, executed: false, confirmations: 0 }));
        emit TransactionSubmitted(txId, msg.sender, to, value, data);
        confirmTransaction(txId);
    }

    function confirmTransaction(uint256 txId) public onlyOwner txExists(txId) notExecuted(txId) {
        require(!confirmed[txId][msg.sender], "ProtocolMultisig: already confirmed");
        confirmed[txId][msg.sender] = true;
        transactions[txId].confirmations += 1;
        emit TransactionConfirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        require(confirmed[txId][msg.sender], "ProtocolMultisig: not confirmed");
        confirmed[txId][msg.sender] = false;
        transactions[txId].confirmations -= 1;
        emit TransactionRevoked(txId, msg.sender);
    }

    function executeTransaction(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        Transaction storage item = transactions[txId];
        require(item.confirmations >= threshold, "ProtocolMultisig: below threshold");
        item.executed = true;
        (bool ok, ) = item.to.call{ value: item.value }(item.data);
        require(ok, "ProtocolMultisig: call failed");
        emit TransactionExecuted(txId, msg.sender);
    }
}
