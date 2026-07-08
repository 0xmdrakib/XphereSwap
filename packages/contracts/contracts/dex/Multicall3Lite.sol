// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Multicall3Lite {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory returnData) {
        returnData = new Result[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory ret) = calls[i].target.call(calls[i].callData);
            if (!calls[i].allowFailure) {
                require(success, "Multicall3Lite: call failed");
            }
            returnData[i] = Result(success, ret);
        }
    }

    function getEthBalance(address account) external view returns (uint256 balance) {
        return account.balance;
    }

    function getBlockNumber() external view returns (uint256 blockNumber) {
        return block.number;
    }

    function getCurrentBlockTimestamp() external view returns (uint256 timestamp) {
        return block.timestamp;
    }
}
